import { NextResponse } from 'next/server';
import { isAiConfigured } from '@/lib/agent/chat';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    aiEnabled: isAiConfigured(),
    provider: 'openai',
  });
}
