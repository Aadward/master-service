import { NextResponse } from "next/server";
import { reapExpiredClaims } from "@/lib/claim-reaper";

/**
 * POST /api/admin/reap-expired
 * 手动触发一次 claim 超时回收（也由后台 reaper 周期性执行）
 */
export async function POST() {
  const reclaimed = await reapExpiredClaims();
  return NextResponse.json({ reclaimed });
}
