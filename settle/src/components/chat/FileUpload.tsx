'use client';

import { useState, useRef, useCallback } from 'react';
import { Paperclip, X, Loader2, FileText, Image as ImageIcon, File } from 'lucide-react';

interface FileUploadProps {
  orderId: string;
  onUploadComplete: (fileUrl: string, fileType: 'image' | 'document', fileName: string) => void;
  onUploadError?: (error: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

interface UploadSignature {
  signature: string;
  timestamp: number;
  cloudName: string;
  apiKey: string;
  folder: string;
}

type FileCategory = 'image' | 'document';

const getFileCategory = (file: File): FileCategory => {
  if (file.type.startsWith('image/')) return 'image';
  return 'document';
};

const getFileIcon = (category: FileCategory, fileName: string) => {
  if (category === 'image') return <ImageIcon className="w-4 h-4" />;
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return <FileText className="w-4 h-4 text-red-400" />;
  if (['doc', 'docx'].includes(ext || '')) return <FileText className="w-4 h-4 text-blue-400" />;
  return <File className="w-4 h-4" />;
};

export function FileUpload({
  orderId,
  onUploadComplete,
  onUploadError,
  disabled = false,
  compact = false,
}: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewData, setPreviewData] = useState<{ url: string; name: string; category: FileCategory } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Allowed file types
  const acceptedTypes = 'image/*,.pdf,.doc,.docx';
  const maxFileSize = 10 * 1024 * 1024; // 10MB

  // Get upload signature from server
  const getSignature = async (): Promise<UploadSignature | null> => {
    try {
      const res = await fetch('/api/upload/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        console.log('Upload signature API not available - demo mode');
        onUploadError?.('File upload not available in demo mode');
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

    // Determine resource type based on file
    const isImage = file.type.startsWith('image/');
    const resourceType = isImage ? 'image' : 'raw';

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

        xhr.open('POST', `https://api.cloudinary.com/v1_1/${signature.cloudName}/${resourceType}/upload`);
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
    const validTypes = ['image/', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const isValid = validTypes.some(type => file.type.startsWith(type) || file.type === type);

    if (!isValid) {
      onUploadError?.('Please select an image, PDF, or Word document');
      return;
    }

    // Validate file size
    if (file.size > maxFileSize) {
      onUploadError?.('File must be smaller than 10MB');
      return;
    }

    const category = getFileCategory(file);

    // Show preview
    if (category === 'image') {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewData({ url: e.target?.result as string, name: file.name, category });
      };
      reader.readAsDataURL(file);
    } else {
      setPreviewData({ url: '', name: file.name, category });
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Get signature
      const signature = await getSignature();
      if (!signature) {
        setIsUploading(false);
        setPreviewData(null);
        return;
      }

      // Upload to Cloudinary
      const fileUrl = await uploadToCloudinary(file, signature);
      if (fileUrl) {
        onUploadComplete(fileUrl, category, file.name);
      } else {
        onUploadError?.('Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      onUploadError?.('Upload failed');
    } finally {
      setIsUploading(false);
      setPreviewData(null);
      setUploadProgress(0);
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

  // Cancel upload preview
  const cancelPreview = () => {
    setPreviewData(null);
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
        accept={acceptedTypes}
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled || isUploading}
      />

      {/* Upload button */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || isUploading}
        className={`${compact ? 'w-9 h-9' : 'p-2'} rounded-lg bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center`}
        title="Attach file (images, PDF, docs)"
      >
        {isUploading ? (
          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
        ) : (
          <Paperclip className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {/* Upload preview overlay */}
      {previewData && (
        <div className="absolute bottom-full left-0 mb-2 p-3 bg-[#1a1a1a] rounded-lg border border-white/10 shadow-xl min-w-[180px]">
          <div className="relative">
            {previewData.category === 'image' && previewData.url ? (
              <img
                src={previewData.url}
                alt="Upload preview"
                className="w-32 h-32 object-cover rounded-lg"
              />
            ) : (
              <div className="w-32 h-24 bg-white/[0.05] rounded-lg flex flex-col items-center justify-center gap-2">
                {getFileIcon(previewData.category, previewData.name)}
                <span className="text-[10px] text-gray-400 px-2 text-center truncate max-w-full">
                  {previewData.name}
                </span>
              </div>
            )}

            {isUploading && (
              <div className="absolute inset-0 bg-black/60 rounded-lg flex flex-col items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin mb-2" />
                <span className="text-xs text-white">{uploadProgress}%</span>
              </div>
            )}

            {!isUploading && (
              <button
                onClick={cancelPreview}
                className="absolute -top-2 -right-2 p-1 bg-red-500 rounded-full hover:bg-red-600 transition-colors"
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

export default FileUpload;
