import React from 'react'
import ActiveChatLoader from '@/modules/chat/components/active-chat-loader'
import Messageviewform from '@/modules/chat/components/message-view-form';



const Page = async ({ params }) => {
  const { chatId } = await params;

  return (
    <>
      <ActiveChatLoader chatId={chatId} />
    
      <Messageviewform chatId={chatId} />
    </>
  );
};

export default Page;