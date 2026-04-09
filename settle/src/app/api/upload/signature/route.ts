import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { requireAuth } from '@/lib/middleware/auth';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: NextRequest) {
  // Rate limit upload signatures
  const rl = await checkRateLimit(request, 'upload:signature', STANDARD_LIMIT);
  if (rl) return rl;

  // Require authenticated user/merchant
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    // Get request body
    const body = await request.json();
    const { folder = 'blip/chat', orderId } = body;

    // Validate folder — prevent path traversal
    const ALLOWED_FOLDERS = ['blip/chat', 'blip/orders', 'blip/receipts', 'blip/profiles'];
    const baseFolder = folder.split('/')[0] + '/' + (folder.split('/')[1] || '');
    if (!ALLOWED_FOLDERS.includes(baseFolder)) {
      return NextResponse.json(
        { success: false, error: 'Invalid upload folder' },
        { status: 400 }
      );
    }

    // Validate Cloudinary is configured
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME;
    if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_API_KEY || !cloudName) {
      return NextResponse.json(
        { success: false, error: 'Cloudinary not configured' },
        { status: 500 }
      );
    }

    // Generate timestamp
    const timestamp = Math.round(new Date().getTime() / 1000);

    // Build folder path with order ID if provided
    const uploadFolder = orderId ? `${folder}/${orderId}` : folder;

    // Parameters to sign — must match exactly what the client sends in the upload FormData
    const params: Record<string, string | number> = {
      timestamp,
      folder: uploadFolder,
    };

    // Generate signature
    const signature = cloudinary.utils.api_sign_request(
      params,
      process.env.CLOUDINARY_API_SECRET
    );

    return NextResponse.json({
      success: true,
      data: {
        signature,
        timestamp,
        cloudName,
        apiKey: process.env.CLOUDINARY_API_KEY,
        folder: uploadFolder,
      },
    });
  } catch (error) {
    console.error('Signature generation error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate upload signature' },
      { status: 500 }
    );
  }
}
