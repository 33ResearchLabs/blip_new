'use client';

import { useState, useRef, useCallback } from 'react';
import { ImagePlus, X, Loader2 } from 'lucide-react';

interface ImageUploadProps {
  orderId: string;
  onUploadComplete: (imageUrl: string) => void;
  onUploadError?: (error: string) => void;
  disabled?: boolean;
}

interface UploadSignature {
  signature: string;
  timestamp: number;
  cloudName: string;
  apiKey: string;
  folder: string;
}

export function ImageUpload({
  orderId,
  onUploadComplete,
  onUploadError,
  disabled = false,
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get upload signature from server
  const getSignature = async (): Promise<UploadSignature | null> => {
    try {
      const res = await fetch('/api/upload/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        // API not available (demo mode)
        console.log('Upload signature API not available - demo mode');
        onUploadError?.('Image upload not available in demo mode');
        return null;
      }
      const data = await res.json();
      if (data.success) {
        return data.data;
      }
      throw new Error(data.error || 'Failed to get signature');
    } catch (error) {
      console.error('Signature error:', error);
      onUploadError?.('Failed to initialize upload');
      return null;
    }
  };

  // Upload file to Cloudinary
  const uploadToCloudinary = async (file: File, signature: UploadSignature): Promise<string | null> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('signature', signature.signature);
    formData.append('timestamp', signature.timestamp.toString());
    formData.append('api_key', signature.apiKey);
    formData.append('folder', signature.folder);

    try {
      const xhr = new XMLHttpRequest();

      return new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(progress);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            resolve(response.secure_url);
          } else {
            reject(new Error('Upload failed'));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error'));
        });

        xhr.open('POST', `https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`);
        xhr.send(formData);
      });
    } catch (error) {
      console.error('Upload error:', error);
      return null;
    }
  };

  // Handle file selection
  const handleFileSelect = useCallback(async (file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      onUploadError?.('Please select an image file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      onUploadError?.('Image must be smaller than 10MB');
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Get signature
      const signature = await getSignature();
      if (!signature) {
        setIsUploading(false);
        setPreviewUrl(null);
        return;
      }

      // Upload to Cloudinary
      const imageUrl = await uploadToCloudinary(file, signature);
      if (imageUrl) {
        onUploadComplete(imageUrl);
      } else {
        onUploadError?.('Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      onUploadError?.('Upload failed');
    } finally {
      setIsUploading(false);
      setPreviewUrl(null);
      setUploadProgress(0);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [orderId, onUploadComplete, onUploadError]);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Cancel upload preview
  const cancelPreview = () => {
    setPreviewUrl(null);
    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="relative">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled || isUploading}
      />

      {/* Upload button */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        disabled={disabled || isUploading}
        className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Upload image"
      >
        {isUploading ? (
          <Loader2 className="w-5 h-5 text-white/60 animate-spin" />
        ) : (
          <ImagePlus className="w-5 h-5 text-white/60" />
        )}
      </button>

      {/* Upload preview overlay */}
      {previewUrl && (
        <div className="absolute bottom-full left-0 mb-2 p-2 bg-[#1a1a1a] rounded-lg border border-white/10 shadow-xl">
          <div className="relative">
            <img
              src={previewUrl}
              alt="Upload preview"
              className="w-32 h-32 object-cover rounded-lg"
            />
            {isUploading && (
              <div className="absolute inset-0 bg-black/60 rounded-lg flex flex-col items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin mb-2" />
                <span className="text-xs text-white">{uploadProgress}%</span>
              </div>
            )}
            {!isUploading && (
              <button
                onClick={cancelPreview}
                className="absolute -top-2 -right-2 p-1 bg-red-500 rounded-full"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ImageUpload;
