import { put } from '@vercel/blob';

// uploadAsset.js
// Disable the default Next.js body parser.
// This is crucial because we need to handle the raw file stream, not a JSON object.
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(request, response) {
  // Ensure the request is a POST request.
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  // Get the filename and content type from the headers sent by the frontend.
  // Using a custom header for the filename is a robust way to pass this info.
  const filename = request.headers['x-vercel-filename'] || `asset-${Date.now()}`;
  const contentType = request.headers['content-type'];

  if (!contentType) {
      return response.status(400).json({ error: 'Content-Type header is required.' });
  }

  try {
    // The `put` function uploads the file from the raw request body.
    // `request.body` in a Vercel Function with `bodyParser: false` is the file stream.
    const { url: permanentUrl } = await put(filename, request.body, {
      access: 'public', // Make the file publicly accessible via its URL.
      contentType,      // Set the correct MIME type (e.g., 'video/mp4', 'application/pdf').
    });

    // On success, return the new permanent URL to the frontend.
    return response.status(200).json({ success: true, url: permanentUrl });

  } catch (error) {
    // If any error occurs during the upload, log it and send a 500 error.
    console.error("Error uploading to Vercel Blob:", error);
    return response.status(500).json({ error: 'Failed to upload file.' });
  }
}
