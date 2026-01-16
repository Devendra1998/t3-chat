import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from 'next/server';

/**
 * Handle GET requests to retrieve free models from OpenRouter and return them in a formatted JSON response.
 * 
 * Queries the OpenRouter models endpoint, filters models whose prompt and completion pricing are effectively zero,
 * and returns a list of formatted model objects.
 * 
 * @param {Request} req - Incoming request object.
 * @returns {NextResponse} On success, a JSON response with `{ models: Array<object> }`. If unauthorized, a JSON response `{ success: false, error: 'Unauthorized' }`. On failure, a JSON response `{ success: false, error: string }` describing the error.
 */
export async function GET(req) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error('Failed to parse OpenRouter API response');
    }
    const items = Array.isArray(data?.data) ? data.data : [];
    
    const freeModels = items.filter(model => {
      const p = parseFloat(model.pricing?.prompt ?? '0');
      const c = parseFloat(model.pricing?.completion ?? '0');
      
      const prompt = Number.isFinite(p) ? p : 0;
      const completion = Number.isFinite(c) ? c : 0;
      
      // Use epsilon for float comparison
      return Math.abs(prompt) < 1e-9 && Math.abs(completion) < 1e-9;
    });
    
    // Return formatted response with useful model information
    const formattedModels = freeModels.map(model => ({
      id: model.id,
      name: model.name,
      description: model.description,
      context_length: model.context_length,
      architecture: model.architecture,
      pricing: model.pricing,
      top_provider: model.top_provider,
    }));

    return NextResponse.json({
      models: formattedModels,
    });

  } catch (error) {
    console.error('Error fetching free models:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch free models',
      },
      { status: 500 }
    );
  }
}