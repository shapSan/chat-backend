import { put, list, del } from '@vercel/blob';
import crypto from 'crypto';

// Set max duration for Vercel functions
export const maxDuration = 30; // 30 seconds for slide operations

// CORS allowed origins
const ALLOWED_ORIGINS = [
  'https://www.selfrun.ai',
  'https://selfrun.ai',
  'https://agentpitch.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000'
];

export default async function handler(req, res) {
  // Simple CORS - allow all origins for now
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const { html, assets = [] } = req.body;
      
      if (!html) {
        return res.status(400).json({ error: 'HTML content is required' });
      }

      // Generate unique token for this slide
      const token = crypto.randomBytes(16).toString('hex');
      const timestamp = Date.now();
      
      // Store main HTML
      const htmlBlob = await put(`slides/${token}/index.html`, html, {
        access: 'public',
        contentType: 'text/html',
      });

      // Store any assets
      const assetUrls = [];
      for (const asset of assets) {
        if (asset.content && asset.name) {
          const assetBlob = await put(
            `slides/${token}/assets/${asset.name}`,
            Buffer.from(asset.content, 'base64'),
            {
              access: 'public',
              contentType: asset.type || 'application/octet-stream',
            }
          );
          assetUrls.push({ name: asset.name, url: assetBlob.url });
        }
      }

      // Return the publication details with the correct frontend URL
      const frontendUrl = 'https://www.selfrun.ai/agentpitch/published';
      
      return res.status(200).json({
        success: true,
        token,
        url: `${frontendUrl}?token=${token}`,
        blobUrl: htmlBlob.url,
        viewUrl: `${process.env.NEXT_PUBLIC_BASE_URL || ''}/view/${token}`,
        assets: assetUrls,
        timestamp,
      });
    } catch (error) {
      console.error('Error publishing slide:', error);
      return res.status(500).json({ error: 'Failed to publish slide' });
    }
  }

  if (req.method === 'GET') {
    try {
      // List published slides
      const { blobs } = await list({ prefix: 'slides/' });
      
      // Group by token/slide
      const slides = {};
      for (const blob of blobs) {
        const parts = blob.pathname.split('/');
        if (parts.length >= 2) {
          const token = parts[1];
          if (!slides[token]) {
            slides[token] = {
              token,
              files: [],
              created: blob.uploadedAt,
            };
          }
          slides[token].files.push(blob);
        }
      }
      
      return res.status(200).json({
        success: true,
        slides: Object.values(slides),
      });
    } catch (error) {
      console.error('Error listing slides:', error);
      return res.status(500).json({ error: 'Failed to list slides' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { token } = req.query;
      
      if (!token) {
        return res.status(400).json({ error: 'Token is required' });
      }
      
      // Delete all files for this slide
      const { blobs } = await list({ prefix: `slides/${token}/` });
      
      for (const blob of blobs) {
        await del(blob.url);
      }
      
      return res.status(200).json({
        success: true,
        message: `Slide ${token} deleted`,
      });
    } catch (error) {
      console.error('Error deleting slide:', error);
      return res.status(500).json({ error: 'Failed to delete slide' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
