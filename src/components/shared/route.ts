import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(
  request: Request,
  { params }: { params: { tripId: string, stopId: string } }
) {
  try {
    const { stopId } = params;
    const body = await request.json();
    
    // Extract proof of delivery details from the request
    const { recipientName, recipientSignature, deliveryPhoto, notes } = body;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update the Trip Drop Point to completed and attach the proof
      const stop = await tx.tripDropPoint.update({
        where: { id: stopId },
        data: {
          status: 'COMPLETED',
          actualDeparture: new Date(),
          recipientName,
          recipientSignature, // This would ideally be a URL to an S3 bucket or base64 string
          deliveryPhoto,      // URL to the uploaded photo
          notes: notes || null
        }
      });

      // 2. If this stop is associated with an Order, update the Order status
      if (stop.orderId) {
        await tx.order.update({
          where: { id: stop.orderId },
          data: { 
            status: 'DELIVERED', 
            deliveredAt: new Date() 
          }
        });
      }

      return stop;
    });

    return NextResponse.json({ success: true, stop: result });
  } catch (error: any) {
    console.error("Proof of Delivery Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}