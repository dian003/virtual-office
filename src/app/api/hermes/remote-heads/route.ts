import { NextResponse } from 'next/server'
import { getRemoteHeadStatuses } from '@/lib/hermes/remote-health'

export const dynamic = 'force-dynamic'

/**
 * Daftar remote head + status hidupnya.
 *
 * Probe health-nya di remote-health.ts (GET <baseUrl>/, timeout 4 dtk per
 * head, paralel, cache 10 dtk) supaya pemanggil lain (roster ruangan,
 * daftar chat) memakai hasil yang sama tanpa mem-probe ulang.
 */
export async function GET() {
  const heads = await getRemoteHeadStatuses()
  return NextResponse.json({ heads, checkedAt: new Date().toISOString(), cached: false })
}
