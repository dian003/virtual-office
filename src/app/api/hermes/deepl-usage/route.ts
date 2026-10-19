import { NextResponse } from 'next/server'
import { getDeeplUsage } from '@/lib/hermes/deepl-usage'

export const dynamic = 'force-dynamic'

/**
 * GET /api/hermes/deepl-usage — saldo DeepL pool translator:
 * per key + TOTAL gabungan semua key (dipakai panel Sistem).
 */
export async function GET() {
  try {
    const report = await getDeeplUsage()
    return NextResponse.json(report)
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'deepl_usage_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}
