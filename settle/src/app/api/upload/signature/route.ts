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

/**
 * SINGLE SOURCE OF TRUTH for signed upload parameters.
 * Both the backend (signature) and frontend (FormData) must use
 * exactly these params — nothing more, nothing less.
 * If you add a param here, the frontend MUST also send it in FormData.
 */
function buildSignedParams(folder: string): Record<string, string | number> {
  return {
    folder,
    timestamp: Math.round(Date.now() / 1000),
  };
}

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

    // Build folder path with order ID if provided
    const uploadFolder = orderId ? `${folder}/${orderId}` : folder;

    // Build signed params from the single source of truth
    const params = buildSignedParams(uploadFolder);

    // Generate signature — Cloudinary uses SHA1(sorted_params + API_SECRET)
    const signature = cloudinary.utils.api_sign_request(
      params,
      process.env.CLOUDINARY_API_SECRET
    );

    // Diagnostic logging (dev only)
    if (process.env.NODE_ENV !== 'production') {
      const stringToSign = Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&');
      console.log('[upload/signature] string_to_sign:', stringToSign);
    }

    return NextResponse.json({
      success: true,
      data: {
        signature,
        timestamp: params.timestamp,
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
