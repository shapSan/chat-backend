
import { kv } from '@vercel/kv';
import bcrypt from 'bcrypt';

// Set max duration
export const maxDuration = 10;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { token, password } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }
    
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }
    
    // Fetch from KV
    const doc = await kv.get(`slide:${token}`);
    
    if (!doc) {
      return res.status(404).json({ error: 'Slide not found' });
    }
    
    // Check password
    if (doc.editPassword) {
      const valid = await bcrypt.compare(password, doc.editPassword);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid password' });
      }
    } else {
      // No password set on this slide
      return res.status(403).json({ error: 'This slide is not editable' });
    }
    
    // Return structured data (ready for editor)
    return res.status(200).json({
      success: true,
      slides: doc.slides,
      templateId: doc.templateId,
      brandName: doc.brandName,
      projectName: doc.projectName,
      brandData: doc.brandData,
      partnershipData: doc.partnershipData,
      token: doc.token
    });
    
  } catch (error) {
    console.error('[getSlideForEdit] Error:', error);
    return res.status(500).json({ error: 'Failed to load slide' });
  }
}
