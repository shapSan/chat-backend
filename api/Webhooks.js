// api/brandWebhook.js
import { kv } from '@vercel/kv';
import fetch from 'node-fetch';

export const maxDuration = 60;

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-HubSpot-Signature-v3');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // ONE-TIME SETUP ROUTE: ?action=setup
  if (req.query?.action === 'setup') {
    // Require auth for setup
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
    const APP_ID = process.env.HUBSPOT_APP_ID;
    const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://chat-backend-vert.vercel.app/api/Webhooks';
    
    if (!APP_ID) {
      return res.status(400).json({ error: 'HUBSPOT_APP_ID not configured in environment variables' });
    }
    
    try {
      const propertiesToWatch = [
        'hubspot_owner_id',
        'client_status',
        'new_product_main_category',
        'relationship_type'
      ];
      
      const results = [];
      
      // Create subscriptions
      for (const property of propertiesToWatch) {
        try {
          const response = await fetch(
            `https://api.hubapi.com/webhooks/v3/${APP_ID}/subscriptions`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                eventType: 'propertyChange',
                objectType: '2-26628489', // Brands custom object
                propertyName: property,
                active: true,
                targetUrl: WEBHOOK_URL
              })
            }
          );
          
          if (response.ok) {
            const data = await response.json();
            results.push({ property, status: 'success', subscriptionId: data.id });
          } else {
            const error = await response.text();
            results.push({ property, status: 'failed', error });
          }
        } catch (error) {
          results.push({ property, status: 'error', error: error.message });
        }
      }
      
      // Set up creation webhook
      try {
        const createResponse = await fetch(
          `https://api.hubapi.com/webhooks/v3/${APP_ID}/subscriptions`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              eventType: 'creation',
              objectType: '2-26628489',
              active: true,
              targetUrl: WEBHOOK_URL
            })
          }
        );
        
        if (createResponse.ok) {
          results.push({ event: 'creation', status: 'success' });
        }
      } catch (error) {
        results.push({ event: 'creation', status: 'error', error: error.message });
      }
      
      return res.status(200).json({
        message: 'Webhook setup complete',
        webhookUrl: WEBHOOK_URL,
        results
      });
      
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to setup webhooks',
        details: error.message
      });
    }
  }
  
  // NORMAL WEBHOOK PROCESSING
  try {
    const webhookPayload = req.body;
    const events = Array.isArray(webhookPayload) ? webhookPayload : [webhookPayload];
    
    // Get current cache
    const cachedBrands = await kv.get('hubspot-brand-cache') || [];
    const brandMap = new Map(cachedBrands.map(brand => [brand.id, brand]));
    
    let addedCount = 0;
    let removedCount = 0;
    let updatedCount = 0;
    
    for (const event of events) {
      const brandId = event.objectId || event.id;
      const properties = event.properties || event;
      
      if (!brandId) continue;
      
      // Check if brand matches filter criteria
      const matchesGroup1 = 
        ['Active', 'Pending (Prospect)'].includes(properties.client_status) &&
        properties.new_product_main_category !== null && 
        properties.new_product_main_category !== undefined &&
        properties.new_product_main_category !== '' &&
        properties.hubspot_owner_id !== null && 
        properties.hubspot_owner_id !== undefined &&
        properties.hubspot_owner_id !== '';
      
      const matchesGroup2 = 
        properties.relationship_type === 'Partner Agency Client';
      
      const shouldBeInCache = matchesGroup1 || matchesGroup2;
      const currentlyInCache = brandMap.has(brandId);
      
      if (shouldBeInCache) {
        if (currentlyInCache) {
          // Update existing brand
          brandMap.set(brandId, {
            id: brandId,
            properties: {
              ...brandMap.get(brandId).properties,
              ...properties,
              hs_lastmodifieddate: Date.now()
            }
          });
          updatedCount++;
        } else {
          // Add new brand to cache
          brandMap.set(brandId, {
            id: brandId,
            properties: {
              ...properties,
              hs_lastmodifieddate: Date.now()
            }
          });
          addedCount++;
        }
      } else if (currentlyInCache) {
        // Remove brand from cache
        brandMap.delete(brandId);
        removedCount++;
      }
    }
    
    // Update cache if changes were made
    if (addedCount > 0 || removedCount > 0 || updatedCount > 0) {
      const newCache = Array.from(brandMap.values());
      await kv.set('hubspot-brand-cache', newCache);
      await kv.set('hubspot-brand-cache-timestamp', Date.now());
      
      // Alert if cache exceeds threshold
      if (newCache.length > 500) {
        console.error(`[WEBHOOK ALERT] Brand cache exceeds 500 limit: ${newCache.length} brands`);
      }
      
      console.log(`[WEBHOOK AUDIT] Cache updated: +${addedCount} -${removedCount} ~${updatedCount} = ${newCache.length} total`);
      
      return res.status(200).json({
        status: 'ok',
        added: addedCount,
        removed: removedCount,
        updated: updatedCount,
        total: newCache.length,
        warning: newCache.length > 500 ? `Cache exceeds 500 limit: ${newCache.length} brands` : null
      });
    }
    
    return res.status(200).json({
      status: 'ok',
      message: 'No cache changes needed',
      total: cachedBrands.length
    });
    
  } catch (error) {
    console.error('[WEBHOOK] Error processing webhook:', error);
    return res.status(500).json({ 
      error: 'Failed to process webhook',
      details: error.message 
    });
  }
}
