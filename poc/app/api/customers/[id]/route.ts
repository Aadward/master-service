import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const customer = await db.customer.findUnique({
    where: { customerId: params.id },
  });
  if (!customer) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json(customer);
}
