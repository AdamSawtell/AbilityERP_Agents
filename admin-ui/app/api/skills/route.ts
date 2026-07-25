import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { listSkills } from '@/lib/services/skills';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const skills = await listSkills();
    return NextResponse.json({ skills });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
