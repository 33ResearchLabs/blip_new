# Cloudinary Upload Preset Configuration

## Setup Instructions

To configure the `blip_chat` upload preset in your Cloudinary dashboard:

1. **Login to Cloudinary Dashboard**
   - Go to https://cloudinary.com/console
   - Sign in to your account

2. **Navigate to Upload Settings**
   - Click on **Settings** (gear icon) in the top right
   - Select **Upload** from the left sidebar

3. **Create Upload Preset**
   - Scroll down to **Upload presets** section
   - Click **Add upload preset**

4. **Configure Preset**
   - **Preset name**: `blip_chat`
   - **Signing mode**: `Signed` (recommended for security)
   - **Folder**: Leave empty (folder is set dynamically in the code)
   - **Access mode**: `Public`
   - **Delivery type**: `Upload`

5. **Optional Settings** (Recommended)
   - **Max file size**: 10 MB
   - **Allowed formats**: `jpg,png,gif,webp,heic`
   - **Auto-tagging**: Enable for better organization
   - **Quality**: `auto:good` (balances quality and file size)
   - **Format**: `auto` (optimizes format automatically)

6. **Save Preset**
   - Click **Save** at the bottom

## Environment Variables

Ensure these are set in your `.env.local`:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloud_name
```

## Upload Folders Structure

The app uses the following folder structure:
- `blip/chat/{orderId}` - Chat attachments for specific orders
- `blip/chat` - General chat attachments

## Testing

After setup, test the upload functionality:
1. Start a chat in an active order
2. Upload an image
3. Check Cloudinary console to verify the file appears in `blip/chat/` folder

## Security Notes

- The preset is configured as **Signed** to prevent unauthorized uploads
- Signatures are generated server-side in `/api/upload/signature`
- All uploads require a valid signature with timestamp
- Signatures expire after a short period for security
