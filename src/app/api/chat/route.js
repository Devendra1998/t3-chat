import { convertToModelMessages, streamText } from "ai";
import { CHAT_SYSTEM_PROMPT } from "@/lib/prompt";
import db from "@/lib/db";
import { MessageRole, MessageType } from "@/generated/prisma";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";


const provider = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});



function convertStoredMessageToUI(msg) {
  try {
    const parts = JSON.parse(msg.content);
    const validParts = parts.filter(part => {
      return part.type === 'text';
    });

    if (validParts.length === 0) {
      return null;
    }

    return {
      id: msg.id,
      role: msg.messageRole.toLowerCase(),
      parts: validParts,
      createdAt: msg.createdAt,
    };
  } catch (e) {

    return {
      id: msg.id,
      role: msg.messageRole.toLowerCase(),
      parts: [{ type: "text", text: msg.content }],
      createdAt: msg.createdAt,
    };
  }
}

function extractPartsAsJSON(message) {
  if (message.parts && Array.isArray(message.parts)) {
    return JSON.stringify(message.parts);
  }

  const content = message.content || "";
  return JSON.stringify([{ type: "text", text: content }]);
}

export async function POST(req) {
  try {
    const {
      chatId,
      messages: newMessages,
      content,
      model,
      skipUserMessage
    } = await req.json();

    if (!model || typeof model !== 'string') {
      return new Response(JSON.stringify({ error: "Invalid or missing model" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const incoming = Array.isArray(newMessages)
      ? newMessages
      : Array.isArray(content)
        ? content
        : (newMessages ?? content ?? []);

    const filteredIncoming = incoming.filter(m => m != null);

    if (filteredIncoming.length === 0 && !chatId) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const previousMessages = chatId
      ? await db.message.findMany({
        where: { chatId },
        orderBy: { createdAt: "asc" },
      })
      : [];


    const uiMessages = previousMessages
      .map(convertStoredMessageToUI)
      .filter(msg => msg !== null); // Remove invalid messages

    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
      console.log("📊 Previous messages:", uiMessages.length);
      console.log("📊 New messages:", filteredIncoming.length);
    } else {
      console.log(`📊 Messages summary: prev=${uiMessages.length}, new=${filteredIncoming.length}`);
    }

    // ✅ FIXED: Combine messages and ensure roles alternate
    const combinedUIMessages = [...uiMessages];
    for (const msg of filteredIncoming) {
      const lastMsg = combinedUIMessages[combinedUIMessages.length - 1];
      if (lastMsg && lastMsg.role === msg.role) {
        // Merge identical consecutive roles into one
        const lastParts = lastMsg.parts || [{ type: 'text', text: lastMsg.content || '' }];
        const newParts = msg.parts || [{ type: 'text', text: msg.content || '' }];
        lastMsg.parts = [...lastParts, ...newParts];
      } else {
        combinedUIMessages.push(msg);
      }
    }

    const allUIMessages = combinedUIMessages;

    // ✅ CRITICAL FIX: convertToModelMessages might fail with tool parts
    // We need to ensure only valid messages are converted
    let modelMessages;
    try {
      modelMessages = await convertToModelMessages(allUIMessages);
      if (isDev) {
        console.log("✅ Converted to model messages:", modelMessages.length);
      }
    } catch (conversionError) {
      console.error("❌ Message conversion error:", conversionError.message || conversionError);

      modelMessages = allUIMessages.map(msg => ({
        role: msg.role,
        content: msg.parts
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join('\n')
      })).filter(m => m.content); // Remove empty messages

      if (isDev) {
        console.log("⚠️ Using fallback conversion:", modelMessages.length);
      }
    }

    if (isDev) {
      console.log("🤖 Final model messages:", JSON.stringify(modelMessages, null, 2));
    }


    // ✅ FIXED: Proper streamText configuration
    const result = streamText({
      model: provider.chat(model),
      messages: modelMessages,
      system: CHAT_SYSTEM_PROMPT,

    });

    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      // Only include the PREVIOUS messages here, as the stream wrapper adds the new/assistant ones
      originalMessages: uiMessages,
      onFinish: async ({ responseMessage }) => {
        try {
          const messagesToSave = [];
          if (!skipUserMessage) {
            const latestUserMessage = filteredIncoming[filteredIncoming.length - 1];

            if (latestUserMessage?.role === "user") {
              const userPartsJSON = extractPartsAsJSON(latestUserMessage);
              messagesToSave.push({
                chatId,
                content: userPartsJSON,
                messageRole: MessageRole.USER,
                model,
                messageType: MessageType.NORMAL,
              });
            }
          }

          // Save assistant response
          if (responseMessage?.parts && responseMessage.parts.length > 0) {
            const assistantPartsJSON = extractPartsAsJSON(responseMessage);
            messagesToSave.push({
              chatId,
              content: assistantPartsJSON,
              messageRole: MessageRole.ASSISTANT,
              model,
              messageType: MessageType.NORMAL,
            });
          }

          if (messagesToSave.length > 0) {
            await db.message.createMany({
              data: messagesToSave,
            });

          }
        } catch (error) {
          console.error("❌ Error saving messages:", error);
        }
      },
    });
  } catch (error) {
    console.error("❌ API Route Error:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
        details: error.toString()
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}