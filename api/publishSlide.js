import { put, list, del } from '@vercel/blob';
import { kv } from '@vercel/kv';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

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
      const { html, assets = [], slides, brandName, projectName, brandData, partnershipData, templateId, isUpdate, token: existingToken } = req.body;
      
      // Validate required fields for structured storage
      if (!slides || !Array.isArray(slides)) {
        return res.status(400).json({ error: 'Slides array is required' });
      }
      
      if (!html) {
        return res.status(400).json({ error: 'HTML content is required' });
      }

      // Determine token (reuse or create new)
      const token = isUpdate && existingToken ? existingToken : crypto.randomBytes(16).toString('hex');
      const timestamp = Date.now();
      
      console.log('[publishSlide] Processing:', { isUpdate, existingToken, token });
      
      // If updating, delete the old blob first to avoid conflicts
      if (isUpdate && existingToken) {
        try {
          const oldBlobUrl = `https://w24qls9w8lqauhdf.public.blob.vercel-storage.com/slides/${existingToken}/index.html`;
          await del(oldBlobUrl);
          console.log('[publishSlide] Deleted old blob:', oldBlobUrl);
        } catch (delError) {
          console.warn('[publishSlide] Could not delete old blob (might not exist):', delError.message);
        }
      }
      
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

      // Store structured data in KV
      const editPassword = process.env.SLIDES_EDIT_PASSWORD;
      if (!editPassword) {
        console.warn('[publishSlide] SLIDES_EDIT_PASSWORD not set, slides will not be editable');
      }
      
      if (isUpdate && existingToken) {
        // Update existing slide
        const existingDoc = await kv.get(`slide:${existingToken}`);
        if (!existingDoc) {
          console.warn('[publishSlide] Original slide not found in KV, will still update blob');
          // Continue anyway - the HTML blob was already updated above
        }
        
        // Update or create KV entry
        await kv.set(`slide:${existingToken}`, {
          ...(existingDoc || {}),
          token: existingToken,
          slides,
          brandName,
          projectName,
          brandData,
          partnershipData,
          templateId,
          editPassword: existingDoc?.editPassword || (editPassword ? await bcrypt.hash(editPassword, 10) : null),
          isPublic: true,
          createdAt: existingDoc?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          uploadedAssets: slides.map(s => s.image).filter(Boolean)
        });
        
        return res.status(200).json({
          success: true,
          token: existingToken,
          message: 'Slide updated successfully',
          url: `https://www.selfrun.ai/agentpitch/published?token=${existingToken}`,
          editUrl: editPassword ? `https://www.selfrun.ai/agentpitch/edit?token=${existingToken}` : null,
          blobUrl: htmlBlob.url,
          timestamp,
        });
      } else {
        // Create new slide
        await kv.set(`slide:${token}`, {
          token,
          slides,
          templateId,
          brandName,
          projectName,
          brandData,
          partnershipData,
          editPassword: editPassword ? await bcrypt.hash(editPassword, 10) : null,
          isPublic: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          uploadedAssets: slides.map(s => s.image).filter(Boolean)
        });
        
        const frontendUrl = 'https://www.selfrun.ai/agentpitch/published';
        
        return res.status(200).json({
          success: true,
          token,
          url: `${frontendUrl}?token=${token}`,
          editUrl: editPassword ? `https://www.selfrun.ai/agentpitch/edit?token=${token}` : null,
          blobUrl: htmlBlob.url,
          viewUrl: `${process.env.NEXT_PUBLIC_BASE_URL || ''}/view/${token}`,
          assets: assetUrls,
          timestamp,
        });
      }
    } catch (error) {
      console.error('[publishSlide] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      // Return the actual error for debugging
      return res.status(500).json({ 
        success: false,
        error: 'Failed to publish slide',
        details: error.message,
        errorName: error.name,
        // Include stack trace in development
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
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
