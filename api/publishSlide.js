import { put, list, del } from '@vercel/blob';
import crypto from 'crypto';

// CORS allowed origins
const ALLOWED_ORIGINS = [
  'https://www.selfrun.ai',
  'https://selfrun.ai',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000'
];

export default async function handler(req, res) {
  // Simple CORS - allow all origins for now
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      sessionId, 
      slides, 
      title, 
      updateExisting = false 
    } = req.body;

    // Basic validation
    if (!slides || slides.length === 0) {
      return res.status(400).json({ error: 'No slides provided' });
    }

    // Generate token
    const token = updateExisting && sessionId 
      ? crypto.createHash('md5').update(sessionId).digest('hex').substring(0, 8)
      : crypto.randomBytes(4).toString('hex');

    console.log('Publishing slides:', {
      slideCount: slides.length,
      token,
      firstSlide: slides[0]
    });

    // Generate standalone HTML
    const htmlContent = generateStandaloneHTML(slides, title);
    console.log('Generated HTML length:', htmlContent.length);

    // Store in Vercel Blob
    const filename = `slides/${token}/index.html`;
    
    // Delete existing if updating
    if (updateExisting) {
      try {
        const existing = await list({ prefix: `slides/${token}/` });
        for (const file of existing.blobs) {
          await del(file.url);
        }
      } catch (e) {
        // Ignore deletion errors
      }
    }

    const blob = await put(filename, htmlContent, {
      access: 'public',
      contentType: 'text/html; charset=utf-8',
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000,
    });
    
    console.log('Blob stored at:', blob.url);
    console.log('Blob metadata:', blob);

    // Store metadata including the actual blob URL
    const metaBlob = await put(`slides/${token}/meta.json`, JSON.stringify({
      title,
      createdAt: new Date().toISOString(),
      slideCount: slides.length,
      htmlUrl: blob.url,  // Store the actual blob URL so frontend can find it
      token
    }), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    // Return the frontend URL where slides can be viewed
    // The frontend will use the token to fetch from blob storage
    const frontendUrl = 'https://www.selfrun.ai/agentpitch/published';
    
    return res.status(200).json({
      success: true,
      url: `${frontendUrl}?token=${token}`,  // Frontend URL with token as query param
      token,
      blobUrl: blob.url,  // Direct blob storage URL for the HTML
      metaUrl: metaBlob.url,  // Direct blob storage URL for the metadata
      htmlUrl: blob.url   // Alias for clarity
    });
  } catch (error) {
    console.error('Publish error:', error);
    return res.status(500).json({ error: 'Failed to publish slides' });
  }
}

function generateStandaloneHTML(slides, title) {
  // Simple HTML escape for safety
  const escape = (str) => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
  
  // Convert slides to HTML sections with Agent Pitch styling
  const slideSections = slides.map((slide, index) => {
    const isTitle = slide.type === 'title';
    
    // Build content based on slide type
    let content = '';
    
    // Header for non-title slides
    if (!isTitle && slide.type) {
      content += `<div class="apHeader">Slide ${index + 1}: ${slide.type.charAt(0).toUpperCase() + slide.type.slice(1)}</div>`;
    }
    
    if (slide.content?.title) {
      content += `<h2 class="apTitle">${escape(slide.content.title)}</h2>`;
    }
    
    if (slide.content?.subtitle) {
      content += `<div class="apSubtitle">${escape(slide.content.subtitle)}</div>`;
    }
    
    if (slide.content?.body) {
      content += `<p class="apBody">${escape(slide.content.body).replace(/\n/g, '<br>')}</p>`;
    }
    
    if (slide.content?.items && slide.content.items.length > 0) {
      content += '<ul class="apBullets">';
      slide.content.items.forEach(item => {
        content += `<li>${escape(item)}</li>`;
      });
      content += '</ul>';
    }
    
    // If no content at all, add debug info
    if (!content) {
      content = `<div class="apTitle">Empty Slide ${index + 1}</div><pre>${JSON.stringify(slide, null, 2)}</pre>`;
    }

    // For title slides, center everything
    if (isTitle) {
      return `
        <section class="apSection title-section">
          <div class="title-container">
            ${content}
          </div>
        </section>
      `;
    }
    
    // For regular slides, use the grid layout with media panel
    return `
      <section class="apSection">
        <div class="apGrid">
          <div class="apLeft">
            ${content}
          </div>
          <div class="apMedia">
            <div class="panel">
              <div class="panel-placeholder">
                <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <p>Media Panel</p>
                <span>Images can be added in editor</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }).join('');

  // Generate the HTML matching AgentPitchSlides.tsx styling
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(title || 'Agent Pitch Presentation')}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
  <style>
    /* Reset and base styles */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    :root {
      --ap-accent1: #F5B642;
      --ap-accent2: #3F8CFF;
      --ap-bone: #EDEAEA;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: var(--ap-bone);
      overflow-x: hidden;
    }
    
    /* Container with scroll snap */
    .apRoot {
      width: 100%;
      height: 100vh;
      overflow-y: auto;
      overflow-x: hidden;
      scroll-snap-type: y mandatory;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    }
    
    /* Section styles */
    section.apSection {
      position: relative;
      min-height: 100vh;
      padding: 6vh 6vw 10vh;
      scroll-snap-align: start;
      z-index: 1;
      box-sizing: border-box;
      display: flex;
      align-items: center;
    }
    
    /* Title section special styling */
    section.title-section {
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    
    .title-container {
      max-width: 900px;
    }
    
    .title-section .apTitle {
      font-size: clamp(48px, 8vw, 96px);
      margin-bottom: 24px;
    }
    
    .title-section .apSubtitle {
      font-size: clamp(18px, 2.5vw, 28px);
    }
    
    /* Grid layout for regular slides */
    .apGrid {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 6vw;
      align-items: center;
      height: 100%;
      width: 100%;
      max-width: 1400px;
      margin: 0 auto;
    }
    
    @media (max-width: 1024px) {
      .apGrid {
        grid-template-columns: 1fr;
        gap: 28px;
      }
    }
    
    /* Text styles */
    .apHeader {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 16px;
      letter-spacing: .12em;
      color: rgba(237, 234, 234, .7);
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    
    .apTitle {
      font-family: ui-sans-serif, system-ui, -apple-system;
      font-weight: 900;
      font-size: clamp(36px, 6vw, 80px);
      line-height: .98;
      letter-spacing: .02em;
      text-transform: uppercase;
      margin: 0 0 12px 0;
      color: var(--ap-bone);
    }
    
    .apSubtitle {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 16px;
      letter-spacing: .08em;
      color: rgba(237, 234, 234, .9);
      text-transform: uppercase;
      margin-bottom: 16px;
    }
    
    .apBody {
      font-size: clamp(16px, 2vw, 22px);
      line-height: 1.65;
      color: rgba(237, 234, 234, .96);
      margin-bottom: 20px;
    }
    
    .apBullets {
      list-style: none;
      padding: 0;
      margin: 10px 0 0 0;
    }
    
    .apBullets li {
      position: relative;
      padding-left: 20px;
      margin: 10px 0;
      font-size: clamp(16px, 2vw, 22px);
      color: rgba(237, 234, 234, .96);
    }
    
    .apBullets li:before {
      content: "•";
      position: absolute;
      left: 0;
      top: 0;
      color: var(--ap-accent1);
    }
    
    /* Media panel */
    .apMedia .panel {
      position: relative;
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, .18);
      overflow: hidden;
      box-shadow: 0 30px 60px rgba(0, 0, 0, .35);
      height: 62vh;
      min-height: 400px;
      backdrop-filter: blur(8px);
      background: linear-gradient(135deg, rgba(245, 182, 66, .1), rgba(63, 140, 255, .1));
    }
    
    .panel-placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: rgba(237, 234, 234, .4);
      gap: 12px;
    }
    
    .panel-placeholder p {
      font-size: 18px;
      font-weight: 500;
    }
    
    .panel-placeholder span {
      font-size: 14px;
      opacity: 0.7;
    }
    
    /* Navigation dots */
    .apDots {
      position: fixed;
      right: 14px;
      top: 50vh;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 9;
    }
    
    .apDots .dot {
      position: relative;
      width: 10px;
      height: 10px;
      border-radius: 3px;
      border: 1px solid rgba(255, 255, 255, .5);
      background: transparent;
      opacity: .7;
      transition: all .2s ease;
      flex-shrink: 0;
      cursor: pointer;
    }
    
    .apDots .dot.active {
      background: linear-gradient(135deg, var(--ap-accent1), var(--ap-accent2));
      border-color: var(--ap-accent1);
      opacity: 1;
    }
    
    .apDots .dot:hover {
      background: linear-gradient(135deg, var(--ap-accent1), var(--ap-accent2));
      border-color: var(--ap-accent2);
      opacity: 1;
    }
    
    .apDots .dotNum {
      position: absolute;
      left: -28px;
      top: 50%;
      transform: translateY(-50%);
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      color: rgba(255, 255, 255, .5);
      letter-spacing: .05em;
      transition: all .2s ease;
      pointer-events: none;
      white-space: nowrap;
    }
    
    .apDots .dot.active .dotNum,
    .apDots .dot:hover .dotNum {
      color: rgba(255, 255, 255, .9);
    }
    
    /* Animations */
    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    /* Mobile responsive */
    @media (max-width: 768px) {
      .apMedia .panel {
        height: 40vh;
        min-height: 300px;
      }
      
      .apDots {
        right: 8px;
        gap: 8px;
      }
      
      .apDots .dot {
        width: 8px;
        height: 8px;
      }
    }
    
    /* Print styles */
    @media print {
      body {
        background: white;
      }
      
      .apRoot {
        height: auto;
        overflow: visible;
      }
      
      section.apSection {
        min-height: auto;
        page-break-after: always;
        padding: 2rem;
      }
      
      .apDots {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="apRoot" id="slides-container">
    ${slideSections}
  </div>
  
  <div class="apDots" id="nav-dots"></div>
  
  <script>
    // Initialize navigation
    const container = document.getElementById('slides-container');
    const slides = document.querySelectorAll('.apSection');
    const dotsContainer = document.getElementById('nav-dots');
    
    // Create dots with numbers
    slides.forEach((slide, index) => {
      const dot = document.createElement('button');
      dot.className = 'dot';
      if (index === 0) dot.classList.add('active');
      
      const dotNum = document.createElement('span');
      dotNum.className = 'dotNum';
      dotNum.textContent = String(index + 1).padStart(2, '0');
      dot.appendChild(dotNum);
      
      dot.onclick = () => {
        slides[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      dotsContainer.appendChild(dot);
    });
    
    // Update active dot on scroll
    const dots = document.querySelectorAll('.dot');
    let ticking = false;
    
    function updateActiveDot() {
      const scrollPos = container.scrollTop + window.innerHeight / 2;
      
      slides.forEach((slide, index) => {
        const slideTop = slide.offsetTop;
        const slideBottom = slideTop + slide.offsetHeight;
        
        if (scrollPos >= slideTop && scrollPos < slideBottom) {
          dots.forEach(d => d.classList.remove('active'));
          if (dots[index]) dots[index].classList.add('active');
        }
      });
      
      ticking = false;
    }
    
    if (container) {
      container.addEventListener('scroll', () => {
        if (!ticking) {
          requestAnimationFrame(updateActiveDot);
          ticking = true;
        }
      });
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      const currentIndex = Array.from(dots).findIndex(d => d.classList.contains('active'));
      
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        const nextIndex = Math.min(currentIndex + 1, slides.length - 1);
        if (slides[nextIndex]) slides[nextIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        const prevIndex = Math.max(currentIndex - 1, 0);
        if (slides[prevIndex]) slides[prevIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    
    console.log('Slides loaded:', slides.length);
  </script>
</body>
</html>
  `;
}
