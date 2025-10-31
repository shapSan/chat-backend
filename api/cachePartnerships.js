// PublishedSlideFrame.tsx - Framer Code Component for viewing published slides
import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

/* ---------- CSS - Comprehensively adapted from HBox.tsx ---------- */
const CSS = `
:root { 
    --hb-accent: #C13E3E; 
    --hb-warm: 0.18; 
    --hb-bone: #EDEAEA; 
}

/* Base iframe container styling */
.publishedSlideRoot {
    width: 100%;
    height: 100%;
    color: var(--hb-bone);
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans';
    position: absolute;
    top: 0;
    left: 0;
}

/* Loading state */
.loadingContainer {
    width: 100%;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--hb-bone);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 16px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

@media (max-width: 768px) {
    .loadingContainer {
        font-size: 14px;
        padding: 0 16px;
    }
}

@media (max-width: 480px) {
    .loadingContainer {
        font-size: 13px;
        padding: 0 12px;
    }
}

/* Loading title styling - matching HBox title */
.loadingTitle {
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans';
    font-weight: 900;
    font-size: clamp(36px, 6vw, 80px);
    line-height: 0.98;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    margin: 0;
    color: var(--hb-bone);
}

@media (max-width: 768px) {
    .loadingTitle {
        font-size: clamp(32px, 10vw, 48px);
        line-height: 1.05;
    }
}

/* HB Star Watermark - matching HBox positioning and styling */
.hb-watermark {
    position: fixed;
    bottom: 24px;
    left: 24px;
    width: clamp(90px, 9vw, 135px);
    height: auto;
    opacity: 0.19;
    pointer-events: none;
    z-index: 999;
    transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    filter: brightness(1.3) contrast(1.2);
}

/* Luxurious gradient overlay for watermark */
.hb-watermark::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 100%);
    pointer-events: none;
    mix-blend-mode: overlay;
}

/* All slides - dynamic luxury placement */
@media (min-width: 769px) {
    .hb-watermark {
        width: clamp(320px, 28vw, 480px);
        bottom: 8vh;
        left: 5vw;
        opacity: 0.14;
        transform: rotate(-3deg);
        filter: brightness(1.4) contrast(1.2);
    }
}

@media (max-width: 768px) {
    .hb-watermark {
        bottom: 16px;
        left: 16px;
        width: 93px;
        opacity: 0.17;
        transform: none;
        filter: brightness(1.3) contrast(1.2);
    }
}

/* Edit button container - matching HBox navigation dots positioning */
.editButtonContainer {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    gap: 12px;
    align-items: center;
}

/* Mobile: Match HBox's mobile positioning with left-aligned content */
@media (max-width: 768px) {
    .editButtonContainer {
        bottom: 20px;
        right: 16px;
        gap: 10px;
    }
}

@media (max-width: 480px) {
    .editButtonContainer {
        bottom: 16px;
        right: 12px;
        gap: 8px;
    }
}

/* Refresh button - matching HBox button styling */
.refreshButton {
    background: rgba(255,255,255,0.06);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    padding: 10px 12px;
    color: rgba(237,234,234,0.7);
    font-size: 13px;
    font-weight: 500;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.02em;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

@media (max-width: 768px) {
    .refreshButton {
        padding: 9px 11px;
        font-size: 12px;
        border-radius: 16px;
        min-width: 44px;
        min-height: 44px;
    }
}

@media (max-width: 480px) {
    .refreshButton {
        padding: 8px 10px;
        font-size: 11px;
        border-radius: 14px;
    }
}

.refreshButton:hover {
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.15);
    color: rgba(237,234,234,0.9);
    transform: translateY(-2px);
}

/* Edit button - matching HBox button styling */
.editButton {
    background: rgba(255,255,255,0.06);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    padding: 10px 18px;
    color: rgba(237,234,234,0.7);
    font-size: 13px;
    font-weight: 500;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.02em;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

@media (max-width: 768px) {
    .editButton {
        padding: 9px 16px;
        font-size: 12px;
        gap: 7px;
        border-radius: 16px;
        min-width: 44px;
        min-height: 44px;
    }
}

@media (max-width: 480px) {
    .editButton {
        padding: 8px 14px;
        font-size: 11px;
        gap: 6px;
        border-radius: 14px;
    }
}

.editButton:hover {
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.15);
    color: rgba(237,234,234,0.9);
    transform: translateY(-2px);
}

/* Password input container */
.passwordInputContainer {
    position: relative;
    background: rgba(255,255,255,0.06);
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.1);
    overflow: hidden;
    display: flex;
    align-items: center;
    transition: all 0.3s ease;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
}

@media (max-width: 768px) {
    .passwordInputContainer {
        border-radius: 16px;
    }
}

@media (max-width: 480px) {
    .passwordInputContainer {
        border-radius: 14px;
    }
}

.passwordInputContainer.error {
    background: rgba(220,53,69,0.1);
    border: 1px solid rgba(220,53,69,0.3);
    animation: shake 0.4s ease;
}

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-10px); }
    75% { transform: translateX(10px); }
}

/* Password input field */
.passwordInput {
    width: 280px;
    height: 56px;
    padding-left: 24px;
    padding-right: 24px;
    background: transparent;
    border: none;
    outline: none;
    font-size: 16px;
    color: #fff;
    transition: padding-right 0.3s ease;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto;
}

@media (max-width: 768px) {
    .passwordInput {
        width: 240px;
        height: 50px;
        padding-left: 20px;
        padding-right: 20px;
        font-size: 15px;
    }
}

@media (max-width: 480px) {
    .passwordInput {
        width: 200px;
        height: 46px;
        padding-left: 18px;
        padding-right: 18px;
        font-size: 14px;
    }
}

.passwordInput.hasButton {
    padding-right: 120px;
}

@media (max-width: 768px) {
    .passwordInput.hasButton {
        padding-right: 110px;
    }
}

@media (max-width: 480px) {
    .passwordInput.hasButton {
        padding-right: 100px;
    }
}

.passwordInput:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.passwordInput::placeholder {
    color: rgba(255, 255, 255, 0.4);
}

/* Submit button */
.submitButton {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    height: 45px;
    width: 100px;
    background: #28a745;
    border-radius: 20px;
    border: none;
    color: #fff;
    font-weight: 600;
    font-size: 15px;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(40, 167, 69, 0.4);
    transition: all 0.2s ease;
}

@media (max-width: 768px) {
    .submitButton {
        height: 40px;
        width: 90px;
        font-size: 14px;
        border-radius: 16px;
    }
}

@media (max-width: 480px) {
    .submitButton {
        height: 36px;
        width: 80px;
        font-size: 13px;
        border-radius: 14px;
    }
}

.submitButton.error {
    background: #ff3b30;
}

.submitButton.success {
    background: #28a745;
}

.submitButton:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.submitButton.pressed {
    transform: translateY(-50%) scale(0.95);
}

.submitButton:hover:not(:disabled) {
    transform: translateY(-50%) scale(1.05);
}

/* Password error message */
.passwordError {
    position: absolute;
    bottom: -35px;
    left: 24px;
    color: #ff3b30;
    font-size: 13px;
    font-weight: 500;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto;
}

@media (max-width: 768px) {
    .passwordError {
        bottom: -32px;
        left: 20px;
        font-size: 12px;
    }
}

@media (max-width: 480px) {
    .passwordError {
        bottom: -30px;
        left: 18px;
        font-size: 11px;
    }
}

/* Icon sizing for mobile - matching HBox */
.icon-sm {
    width: 14px;
    height: 14px;
}

@media (max-width: 768px) {
    .icon-sm {
        width: 13px;
        height: 13px;
    }
}

@media (max-width: 480px) {
    .icon-sm {
        width: 12px;
        height: 12px;
    }
}

.icon-md {
    width: 20px;
    height: 20px;
}

@media (max-width: 768px) {
    .icon-md {
        width: 18px;
        height: 18px;
    }
}

@media (max-width: 480px) {
    .icon-md {
        width: 16px;
        height: 16px;
    }
}
`

export default function PublishedSlideFrame(props: { token?: string }) {
    const [htmlContent, setHtmlContent] = React.useState<string>("")
    const [loading, setLoading] = React.useState(true)
    const [showPasswordInput, setShowPasswordInput] = React.useState(false)
    const [password, setPassword] = React.useState("")
    const [passwordError, setPasswordError] = React.useState("")
    const [isScrolled, setIsScrolled] = React.useState(false)
    const [isPressed, setIsPressed] = React.useState(false)
    const [isTransitioning, setIsTransitioning] = React.useState(false)
    const [isOnFirstOrLastSlide, setIsOnFirstOrLastSlide] = React.useState(true)
    const [refreshKey, setRefreshKey] = React.useState(0) // Force refresh state
    const [isBrandRadar, setIsBrandRadar] = React.useState(false) // Detect Brand Radar template
    const inputRef = React.useRef<HTMLInputElement>(null)
    const iframeRef = React.useRef<HTMLIFrameElement>(null)
    const containerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        // Get token from props or URL
        let token = props.token || ""

        if (!token && typeof window !== "undefined") {
            const urlParams = new URLSearchParams(window.location.search)
            token = urlParams.get("token") || ""
        }

        if (token) {
            // Fetch the HTML directly from blob storage with cache-busting
            // Add timestamp to force fresh fetch and bypass browser cache
            const timestamp = new Date().getTime()
            const blobUrl = `https://w24qls9w8lqauhdf.public.blob.vercel-storage.com/slides/${token}/index.html?v=${timestamp}`

            console.log(
                "[PublishedSlideFrame] Fetching slides with cache-bust:",
                blobUrl
            )

            fetch(blobUrl, {
                cache: "reload", // Force reload from server, bypass cache
            })
                .then((res) => {
                    console.log(
                        "[PublishedSlideFrame] Fetch response:",
                        res.status
                    )
                    return res.text()
                })
                .then((fetchedSlidesHTML) => {
                    console.log(
                        "[PublishedSlideFrame] HTML body loaded, length:",
                        fetchedSlidesHTML.length
                    )

                    // Detect if this is a Brand Radar template
                    const isBrandRadarTemplate =
                        fetchedSlidesHTML.includes("BRAND RADAR") ||
                        fetchedSlidesHTML.includes("Brand Radar")
                    setIsBrandRadar(isBrandRadarTemplate)
                    console.log(
                        "[PublishedSlideFrame] Template detected:",
                        isBrandRadarTemplate ? "Brand Radar" : "Other"
                    )

                    // INJECT PREMIUM CONTACT SLIDE - MATCHING EXISTING SLIDE STRUCTURE
                    console.log(
                        "[PublishedSlideFrame] Injecting premium contact slide"
                    )

                    // Premium contact slide using existing slide structure
                    const lastSlideHTML = `
<section class="apSection">
  <div class="apGrid">
    <!-- Left side: Contact info -->
    <div class="apLeft">
      <div class="contact-accent-line"></div>
      <h2 class="apTitle">Let's Connect</h2>
      <div class="apBody">Explore partnership opportunities with Hollywood Branded.</div>
      <div class="contact-details">
        <div class="contact-detail-item">
          <svg class="contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
          <span>HOLLYWOODBRANDED.COM</span>
        </div>
        <div class="contact-detail-item">
          <svg class="contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
          </svg>
          <span>310.606.2030</span>
        </div>
        <div class="contact-detail-item">
          <svg class="contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>
          <span>partnerships@hollywoodbranded.com</span>
        </div>
      </div>
      
      <!-- Calendar button - mobile only -->
      <button class="calendar-button" id="open-calendar-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        Schedule a Meeting
      </button>
      
      <!-- Footer disclaimer - mobile only, inside left column -->
      <div class="contact-footer-wrapper contact-footer-mobile">
        <div class="contact-footer-line"></div>
        <p class="contact-footer-text">All information in this deck is highly confidential and may not be shared publicly beyond the intended receiver.</p>
      </div>
    </div>
    
    <!-- Right side: Calendar -->
    <div class="apMedia">
      <div class="meetings-iframe-container" data-src="https://info.hollywoodbranded.com/meetings/ian-drummond?embed=true"></div>
    </div>
  </div>
  
  <!-- Footer disclaimer - desktop only, outside grid -->
  <div class="contact-footer-wrapper contact-footer-desktop">
    <div class="contact-footer-line"></div>
    <p class="contact-footer-text">All information in this deck is highly confidential and may not be shared publicly beyond the intended receiver.</p>
  </div>
</section>

<!-- Calendar Modal (outside slides container) -->
<div id="calendar-modal" class="calendar-modal-overlay">
  <div class="calendar-modal-content">
    <div class="calendar-modal-header">
      <h3 class="calendar-modal-title">Schedule a Meeting</h3>
      <button class="calendar-modal-close" id="close-calendar-modal">✕</button>
    </div>
    <div class="calendar-modal-body">
      <div class="meetings-iframe-container" data-src="https://info.hollywoodbranded.com/meetings/ian-drummond?embed=true" id="modal-calendar"></div>
    </div>
  </div>
</div>
`

                    // Append the last slide to the fetched slides HTML
                    const modifiedSlidesHTML = fetchedSlidesHTML + lastSlideHTML

                    // Build the full HTML doc with our centralized CSS
                    const SLIDE_CSS = `
                *{margin:0;padding:0;box-sizing:border-box}
                :root{--ap-accent1:#F5B642;--ap-accent2:#3F8CFF;--ap-bone:#EDEAEA}
                html,body{height:100%;overflow:hidden;background:transparent}
                body{font-family:'Inter',system-ui,sans-serif;color:var(--ap-bone)}
                /* Performance optimizations */
                img,video{will-change:auto;transform:translateZ(0);}
                .apRoot{position:fixed;inset:0;overflow-y:auto;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;contain:layout style;}
                @media (max-width: 768px) {
                  html,body,.apRoot{overflow-x:hidden !important}
                }
                .apSection{position:relative;height:100vh;padding:6vh 6vw 10vh;scroll-snap-align:start;display:flex;align-items:center;contain:layout style;}
                .title-container{max-width:900px;position:relative;z-index:1}
                @media (max-width: 768px) {
                .apSection {height: auto;min-height: 100vh;padding: 90px 16px 60px 16px !important;padding-right: 50px !important;scroll-snap-align: start;scroll-snap-stop: always;}
                .apSection:first-child {padding-top: 30px !important;min-height: 100vh;}
                }
                @media (max-width: 480px) {
                .apSection {padding: 90px 12px 60px !important;padding-right: 50px !important;}
                .apSection:first-child {padding-top: 30px !important;}
                }
                .apGrid{display:grid;grid-template-columns:1.1fr 1fr;gap:6vw;align-items:center;height:100%;width:100%;max-width:1400px;margin:0 auto}
                @media (max-width: 768px) {
                /* First and last slides: Keep single column grid */
                .apSection:first-child .apGrid,
                .apSection:last-child .apGrid {grid-template-columns: 1fr !important;gap: 24px;align-items: flex-start;}
                /* Content slides: Convert to flexbox for reordering */
                .apSection:not(:first-child):not(:last-child) .apGrid {display: flex !important;flex-direction: column;gap: 24px;align-items: flex-start;}
                /* Order at grid level: Header → Title → Subtitle → Image → Left content */
                .apSection:not(:first-child):not(:last-child) .apHeader {order: 1;}
                .apSection:not(:first-child):not(:last-child) .apTitle {order: 2;}
                .apSection:not(:first-child):not(:last-child) .apSubtitle {order: 3;}
                .apSection:not(:first-child):not(:last-child) .apMedia {order: 4 !important;margin-bottom: 20px;width: 100%;}
                .apSection:not(:first-child):not(:last-child) .apLeft {order: 5;width: 100%;}
                }
                @media (max-width: 480px) {.apGrid {gap: 20px;}}
                .apFullWidth{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;height:100%;width:100%;max-width:900px;margin:0 auto}
                @media (max-width: 768px) {
                /* Slides without images: Make apFullWidth use flexbox ordering too */
                .apSection:not(:first-child):not(:last-child) .apFullWidth {display: flex !important;flex-direction: column;gap: 24px;align-items: flex-start;}
                .apSection:not(:first-child):not(:last-child) .apFullWidth .apHeader {order: 1;}
                .apSection:not(:first-child):not(:last-child) .apFullWidth .apTitle {order: 2;}
                .apSection:not(:first-child):not(:last-child) .apFullWidth .apSubtitle {order: 3;}
                .apSection:not(:first-child):not(:last-child) .apFullWidth .apBody {order: 4;}
                .apSection:not(:first-child):not(:last-child) .apFullWidth .apBullets {order: 5;}
                }
                .apHeader{font-size:16px;font-family:ui-monospace,Menlo,Consolas,Inter;letter-spacing:.12em;color:rgba(237,234,234,.7);text-transform:uppercase;margin-bottom:10px}
                @media (max-width: 768px) {.apHeader {font-size: 14px !important;margin-bottom: 12px;letter-spacing: 0.08em;}}
                .apTitle{font-weight:900;font-size:clamp(36px,3.5vw,80px);line-height:.98;letter-spacing:.02em;text-transform:uppercase;margin:0 0 28px 0;padding:0}
                @media (max-width: 768px) {.apTitle {font-size: clamp(32px, 10vw, 48px) !important;line-height: 1.05 !important;margin-bottom: 20px !important;}}
                .title-section .apTitle{font-size:clamp(40px,4.5vw,96px);margin-bottom:24px}
                @media (max-width: 768px) {.title-section .apTitle {font-size: clamp(32px, 10vw, 48px) !important;}}
                .apSubtitle{font-size:16px;font-family:ui-monospace,Menlo,Consolas,Inter;letter-spacing:.08em;color:rgba(237,234,234,.9);text-transform:uppercase;margin:0 0 16px 0;padding:0}
                @media (max-width: 768px) {.apSubtitle {font-size: 11px !important;margin-bottom: 12px;}}
                .title-section .apSubtitle,.apSection:first-child .apSubtitle{font-size:clamp(14px,1.5vw,28px);color:var(--ap-accent1)}
                @media (max-width: 768px) {
                .title-section .apSubtitle,.apSection:first-child .apSubtitle {font-size: 18px !important;}
                /* First slide mobile: Tighter horizontal spacing */
                .apSection:first-child .apGrid{gap:32px;}
                .apSection:first-child .apMedia .panel{width:92%;margin-top:10%;}
                }
                .apBody{font-size:clamp(17px,1.35vw,22px);line-height:1.75;color:rgba(237,234,234,.96);margin-bottom:20px}
                @media (max-width: 768px) {.apBody {font-size: clamp(16px, 4vw, 18px) !important;line-height: 1.6;}}
                .apBody strong{color:rgba(237,234,234,1);font-weight:600}
                .apCast{font-size:clamp(17px,1.3vw,20px);line-height:1.6;color:rgba(237,234,234,.85);margin-bottom:24px;font-weight:500}
                @media (max-width: 768px) {.apCast {font-size: clamp(16px, 4vw, 18px) !important;line-height: 1.5;margin-bottom: 20px;}}
                .apSynopsis{font-size:clamp(17px,1.3vw,20px);line-height:1.75;color:rgba(237,234,234,.88);margin-bottom:24px}
                @media (max-width: 768px) {.apSynopsis {font-size: clamp(16px, 4vw, 18px) !important;line-height: 1.6;margin-bottom: 20px;}}
                .apDates{font-size:clamp(14px,0.95vw,18px);line-height:1.6;color:rgba(245,182,66,.85);font-weight:500;letter-spacing:.02em}
                @media (max-width: 768px) {.apDates {font-size: clamp(14px, 3.5vw, 16px) !important;line-height: 1.5;}}
                .contact-main{font-size:clamp(18px,1.4vw,24px);line-height:1.6;color:rgba(237,234,234,.96);margin-bottom:40px}
                .contact-info{font-size:clamp(16px,1.2vw,20px);line-height:1.8;color:rgba(237,234,234,.9);margin-bottom:60px;font-weight:500}
                .contact-footer{font-size:clamp(13px,0.85vw,16px);line-height:1.6;color:rgba(237,234,234,.65);font-style:italic;padding-top:40px;border-top:1px solid rgba(255,255,255,.1)}
                @media (max-width: 768px) {.contact-main{font-size:clamp(17px,4.5vw,20px)!important;margin-bottom:32px}.contact-info{font-size:clamp(15px,4vw,18px)!important;margin-bottom:48px}.contact-footer{font-size:clamp(12px,3.5vw,15px)!important;padding-top:32px}}
                .apBullets{list-style:none;margin:10px 0 0 0}
                .apBullets li{position:relative;padding-left:20px;margin:10px 0;font-size:clamp(16px,1.1vw,22px);line-height:1.7;color:rgba(237,234,234,.96)}
                @media (max-width: 768px) {.apBullets li {font-size: clamp(15px, 4vw, 18px) !important;line-height: 1.6;margin: 12px 0;padding-left: 18px;}}
                .apBullets li:before{content:"•";position:absolute;left:0;top:0;color:var(--ap-accent1)}
                @media (max-width: 768px) {.apBullets li:before {font-size: 14px;}}
                .apMedia .panel{position:relative;border-radius:24px;border:1px solid rgba(255,255,255,.18);overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.35);aspect-ratio:1/1;background:linear-gradient(135deg,rgba(245,182,66,.1),rgba(63,140,255,.1));contain:paint;}
                /* Optimize media elements for smooth rendering */
                .apMedia .panel img,.apMedia .panel video{width:100%;height:100%;border-radius:24px;image-rendering:auto;}
                /* Blur effect only for images that don't fill (contain mode) */
                .apMedia .panel:has(img[style*="contain"]),
                .apMedia .panel:has(video[style*="contain"]){backdrop-filter:blur(8px);}
                /* First slide only: Portrait aspect ratio (2:3) with performance optimization */
                .apSection:first-child .apMedia .panel{aspect-ratio:2/3;width:85%;margin-top:10%;}
                /* First slide: Reduce gap between title and image for tighter horizontal spacing */
                .apSection:first-child .apGrid{gap:3vw;}
                @media (max-width: 768px) {
                .apMedia .panel {border-radius: 16px;}
                .apMedia .panel img, .apMedia .panel video, .apMedia .panel iframe {border-radius: 16px !important;}
                }
                .panel-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(237,234,234,.4);gap:12px}
                .panel-placeholder p{font-size:18px;font-weight:500}
                @keyframes shimmerWave{0%{background-position:-200% center}100%{background-position:200% center}}
                .media-shimmer{position:absolute;inset:0;background:linear-gradient(110deg,rgba(40,42,46,0.6) 0%,rgba(50,52,56,0.8) 25%,rgba(65,67,71,0.95) 50%,rgba(50,52,56,0.8) 75%,rgba(40,42,46,0.6) 100%);background-size:200% 100%;animation:shimmerWave 2.5s ease-in-out infinite;opacity:1;transition:opacity 0.8s cubic-bezier(0.4,0,0.2,1);pointer-events:none;z-index:1}
                .media-shimmer.loaded{opacity:0}
                .apMedia .panel img,.apMedia .panel video{opacity:0;transition:opacity 1.2s cubic-bezier(0.4,0,0.2,1)}
                .apMedia .panel img.loaded,.apMedia .panel video.loaded{opacity:1}
                .apDots{position:fixed;right:14px;top:50vh;transform:translateY(-50%);display:flex;flex-direction:column;gap:10px;z-index:9}
                .apDots .dot{position:relative;width:10px;height:10px;border-radius:3px;border:1px solid rgba(255,255,255,.5);background:transparent;opacity:.7;transition:all .2s;cursor:pointer}
                .apDots .dot.active{background:linear-gradient(135deg,var(--ap-accent1),var(--ap-accent2));border-color:var(--ap-accent1);opacity:1}
                .apDots .dot:hover{background:linear-gradient(135deg,var(--ap-accent1),var(--ap-accent2));border-color:var(--ap-accent2);opacity:1}
                .apDots .dotNum{position:absolute;left:-28px;top:50%;transform:translateY(-50%);font:12px ui-Inter,Menlo,Consolas,Inter;color:rgba(255,255,255,.5);letter-spacing:.05em;transition:all .2s;pointer-events:none;white-space:nowrap}
                .apDots .dot.active .dotNum,.apDots .dot:hover .dotNum{color:rgba(255,255,255,.9)}
                
                /* PREMIUM CONTACT SLIDE - USING EXISTING STRUCTURE */
                .contact-accent-line{width:60px;height:3px;background:linear-gradient(90deg,#F5B642 0%,rgba(245,182,66,0.3) 100%);margin-bottom:20px;border-radius:2px}
                @media (max-width:768px){.contact-accent-line{width:48px;height:2px;margin-bottom:16px}}
                
                .contact-details{display:flex;flex-direction:column;gap:20px;margin-top:32px}
                @media (max-width:768px){.contact-details{gap:16px;margin-top:24px}}
                
                .contact-detail-item{display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06);transition:all 0.3s ease}
                .contact-detail-item:last-child{border-bottom:none}
                .contact-detail-item:hover{padding-left:6px;border-bottom-color:rgba(245,182,66,0.25)}
                .contact-detail-item:hover .contact-icon{color:#F5B642;transform:scale(1.08)}
                @media (max-width:768px){.contact-detail-item{gap:12px;padding:10px 0}}
                
                .contact-icon{width:22px;height:22px;color:rgba(245,182,66,0.6);flex-shrink:0;transition:all 0.3s ease}
                @media (max-width:768px){.contact-icon{width:18px;height:18px}}
                
                .contact-detail-item span{font-size:clamp(15px,1.15vw,19px);color:rgba(237,234,234,0.88);font-weight:500;letter-spacing:0.02em;font-family:ui-monospace,Menlo,Consolas,monospace}
                @media (max-width:768px){.contact-detail-item span{font-size:clamp(12px,3.2vw,15px)}}
                
                /* Calendar iframe - smaller overall */
                .apMedia .meetings-iframe-container{width:100%;height:147px;max-height:147px;background:transparent;margin-top:-306px}
                @media (min-width:1367px){.apMedia .meetings-iframe-container{height:240px;max-height:240px;margin-top:-274px}}
                @media (max-width:768px){.apMedia .meetings-iframe-container{display:none !important}}
                
                /* Calendar button - mobile only */
                .calendar-button{display:none}
                @media (max-width:768px){.calendar-button{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;padding:18px 24px;margin-top:32px;background:rgba(245,182,66,0.15);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(245,182,66,0.3);border-radius:16px;color:rgba(245,182,66,0.95);font-size:16px;font-weight:600;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto;letter-spacing:0.02em;cursor:pointer;transition:all 0.3s ease;box-shadow:0 4px 16px rgba(245,182,66,0.2)}}
                .calendar-button:active{transform:scale(0.98)}
                .calendar-button svg{width:20px;height:20px;flex-shrink:0}
                
                /* Calendar Modal */
                .calendar-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:16px;animation:fadeIn 0.3s ease;overflow:hidden;z-index:2147483647}
                .calendar-modal-overlay.show{display:flex}
                @keyframes fadeIn{from{opacity:0}to{opacity:1}}
                @keyframes slideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
                .calendar-modal-content{background:rgba(23,25,29,0.98);border:1px solid rgba(255,255,255,0.1);border-radius:20px;max-width:500px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;animation:slideUp 0.4s cubic-bezier(0.4,0,0.2,1);position:relative}
                .calendar-modal-header{padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;min-height:56px}
                .calendar-modal-title{font-size:18px;font-weight:700;color:#EDEAEA;margin:0}
                .calendar-modal-close{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.5);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:none;color:#F5B642;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.3s ease;box-shadow:0 2px 8px rgba(0,0,0,0.3);z-index:10}
                .calendar-modal-close:active{transform:scale(0.95)}
                .calendar-modal-body{flex:1;padding:0;overflow-y:auto;-webkit-overflow-scrolling:touch}
                .calendar-modal-body .meetings-iframe-container{width:100%;height:650px;border:none;background:transparent;display:block !important;margin:0 !important;padding:0}
                @media (max-width:768px){.calendar-modal-content{max-width:92%;max-height:85vh;border-radius:16px}.calendar-modal-header{padding:14px 18px;min-height:52px}.calendar-modal-title{font-size:17px}.calendar-modal-close{top:10px;right:10px;width:34px;height:34px;font-size:17px}.calendar-modal-body{padding:0}.calendar-modal-body .meetings-iframe-container{height:580px}}
                @media (max-width:480px){.calendar-modal-content{max-width:95%;max-height:82vh}.calendar-modal-body .meetings-iframe-container{height:520px}}
                
                .contact-footer-wrapper{position:absolute;bottom:8vh;left:6vw;width:auto;max-width:600px;text-align:left}
                .contact-footer-mobile{display:none}
                .contact-footer-desktop{display:block}
                @media (max-width:768px){.contact-footer-mobile{display:block;position:relative;bottom:auto;left:auto;width:100%;max-width:100%;margin-top:24px;padding:0;text-align:left}.contact-footer-desktop{display:none}}
                
                .contact-footer-line{width:100%;height:1px;background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.12) 50%,transparent 100%);margin-bottom:18px}
                @media (max-width:768px){.contact-footer-line{margin-bottom:14px}}
                
                .contact-footer-text{font-size:clamp(12px,0.85vw,15px);line-height:1.6;color:rgba(237,234,234,0.48);font-style:italic;font-weight:400;margin:0}
                @media (max-width:768px){.contact-footer-text{font-size:clamp(10px,2.8vw,12px);line-height:1.5}}
                `
                    const fullHtmlDoc = `<!DOCTYPE html>
                <html lang="en">
                <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Brand Radar</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet" />
                <style>${SLIDE_CSS}</style>
                </head>
                <body>
                  <div class="apRoot" id="slides-container">${modifiedSlidesHTML}</div>
                  <div class="apDots" id="nav-dots"></div>
                  <script src="https://static.hsappstatic.net/MeetingsEmbed/ex/MeetingsEmbedCode.js" async></script>
                  <script>
                    const container=document.getElementById('slides-container');
                    const slides=document.querySelectorAll('.apSection');
                    const dotsContainer=document.getElementById('nav-dots');
                    if (slides.length > 0) {
                      slides.forEach((slide,index)=>{const dot=document.createElement('button');dot.className='dot';if(index===0)dot.classList.add('active');const dotNum=document.createElement('span');dotNum.className='dotNum';dotNum.textContent=String(index+1).padStart(2,'0');dot.appendChild(dotNum);dot.onclick=()=>{slides[index].scrollIntoView({behavior:'smooth',block:'start'});};dotsContainer.appendChild(dot);});
                      const dots=document.querySelectorAll('.dot');
                      function updateActiveDot(){const scrollPos=container.scrollTop;const windowHeight=window.innerHeight;const middle=scrollPos+windowHeight/2;slides.forEach((slide,index)=>{const top=slide.offsetTop;const bottom=top+slide.offsetHeight;if(middle>=top&&middle<bottom){dots.forEach(d=>d.classList.remove('active'));dots[index]&&dots[index].classList.add('active');}});}
                      let ticking=false;container.addEventListener('scroll',()=>{if(!ticking){window.requestAnimationFrame(()=>{updateActiveDot();ticking=false;});ticking=true;}});
                      updateActiveDot();
                    }
                    // Add shimmer effect to all media elements
                    document.querySelectorAll('.apMedia .panel').forEach(panel=>{const img=panel.querySelector('img');const video=panel.querySelector('video');const mediaEl=img||video;if(mediaEl){const shimmer=document.createElement('div');shimmer.className='media-shimmer';panel.style.position='relative';panel.insertBefore(shimmer,panel.firstChild);const handleLoad=()=>{shimmer.classList.add('loaded');mediaEl.classList.add('loaded');};if(mediaEl.complete||mediaEl.readyState>=3){handleLoad();}else{mediaEl.addEventListener('load',handleLoad);mediaEl.addEventListener('loadeddata',handleLoad);mediaEl.addEventListener('error',handleLoad);}}});
                    
                    // Calendar modal functionality
                    const openCalendarBtn = document.getElementById('open-calendar-btn');
                    const calendarModal = document.getElementById('calendar-modal');
                    const closeCalendarModal = document.getElementById('close-calendar-modal');
                    const modalCalendar = document.getElementById('modal-calendar');
                    
                    if (openCalendarBtn && calendarModal && closeCalendarModal) {
                      openCalendarBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        calendarModal.classList.add('show');
                        document.body.style.overflow = 'hidden';
                        // Initialize calendar in modal if not already done
                        if (window.HubSpotMeetings && modalCalendar && !modalCalendar.classList.contains('initialized')) {
                          modalCalendar.classList.add('initialized');
                          setTimeout(function() {
                            window.HubSpotMeetings.create('#modal-calendar');
                          }, 300);
                        }
                      });
                      
                      closeCalendarModal.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        calendarModal.classList.remove('show');
                        document.body.style.overflow = '';
                      });
                      
                      // Close modal when clicking overlay
                      calendarModal.addEventListener('click', function(e) {
                        if (e.target === calendarModal) {
                          calendarModal.classList.remove('show');
                          document.body.style.overflow = '';
                        }
                      });
                    }
                    
                    // Initialize HubSpot Meetings iframe
                    window.addEventListener('load', function() {
                      if (window.HubSpotMeetings) {
                        window.HubSpotMeetings.create('.meetings-iframe-container:not(#modal-calendar)');
                      } else {
                        // Retry after script loads
                        setTimeout(function() {
                          if (window.HubSpotMeetings) {
                            window.HubSpotMeetings.create('.meetings-iframe-container:not(#modal-calendar)');
                          }
                        }, 1000);
                      }
                    });
                  </script>
                </body>
                </html>`

                    setHtmlContent(fullHtmlDoc)
                    setLoading(false)
                })
                .catch((err) => {
                    console.error("Failed to load slides:", err)
                    setLoading(false)
                })
        } else {
            setLoading(false)
        }
    }, [props.token, refreshKey]) // Re-fetch when refreshKey changes

    // Force page reload on first mount to bypass any cached versions
    React.useEffect(() => {
        // Check if this is a soft navigation (browser back/forward) vs hard refresh
        if (typeof window !== "undefined" && window.performance) {
            const navEntries = window.performance.getEntriesByType(
                "navigation"
            ) as PerformanceNavigationTiming[]
            if (
                navEntries.length > 0 &&
                navEntries[0].type === "back_forward"
            ) {
                // User used back/forward button - force a real reload to get fresh content
                console.log(
                    "[PublishedSlideFrame] Detected back/forward navigation, forcing reload"
                )
                window.location.reload()
            }
        }
    }, [])

    // Listen for page visibility change to refresh content when user returns
    React.useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                // Page became visible - check if we should refresh
                console.log(
                    "[PublishedSlideFrame] Page visible again, checking for updates..."
                )
                setRefreshKey((prev) => prev + 1)
            }
        }

        document.addEventListener("visibilitychange", handleVisibilityChange)
        return () =>
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            )
    }, [])

    // Listen for custom refresh event from edit page
    React.useEffect(() => {
        const handleRefreshRequest = () => {
            console.log(
                "[PublishedSlideFrame] Refresh requested, reloading content..."
            )
            setRefreshKey((prev) => prev + 1)
        }

        window.addEventListener("refreshPublishedSlide", handleRefreshRequest)
        return () =>
            window.removeEventListener(
                "refreshPublishedSlide",
                handleRefreshRequest
            )
    }, [])

    // WATERMARK CONTROL: Hide on first slide only
    React.useEffect(() => {
        const iframe = iframeRef.current
        if (!iframe) return

        const hideOnFirstSlide = () => {
            const watermark = document.querySelector(
                ".hb-watermark"
            ) as HTMLElement
            if (!watermark) return

            try {
                const iframeWindow = iframe.contentWindow
                if (!iframeWindow) return

                const scrollTop = iframeWindow.scrollY || 0
                watermark.style.display = scrollTop < 100 ? "none" : "block"
            } catch (err) {}
        }

        iframe.addEventListener("load", () => {
            const iframeWindow = iframe.contentWindow
            if (iframeWindow) {
                iframeWindow.addEventListener("scroll", hideOnFirstSlide)
                setTimeout(hideOnFirstSlide, 100)
                setTimeout(hideOnFirstSlide, 500)
            }
        })

        return () => {
            try {
                const iframeWindow = iframe.contentWindow
                if (iframeWindow) {
                    iframeWindow.removeEventListener("scroll", hideOnFirstSlide)
                }
            } catch (err) {}
        }
    }, [])

    // Detect first/last slide for edit button visibility
    React.useEffect(() => {
        const iframe = iframeRef.current
        if (!iframe) return

        const checkSlidePosition = () => {
            try {
                const iframeWindow = iframe.contentWindow
                if (iframeWindow) {
                    const scrollTop = iframeWindow.scrollY || 0
                    const scrollHeight =
                        iframeWindow.document.documentElement.scrollHeight
                    const clientHeight = iframeWindow.innerHeight
                    const isOnFirstSlide = scrollTop < 100
                    const isOnLastSlide =
                        scrollTop + clientHeight >= scrollHeight - 100
                    setIsOnFirstOrLastSlide(isOnFirstSlide || isOnLastSlide)
                }
            } catch (err) {}
        }

        iframe.addEventListener("load", () => {
            const iframeWindow = iframe.contentWindow
            if (iframeWindow) {
                iframeWindow.addEventListener("scroll", checkSlidePosition)
                setTimeout(checkSlidePosition, 100)
            }
        })

        return () => {
            try {
                const iframeWindow = iframe.contentWindow
                if (iframeWindow) {
                    iframeWindow.removeEventListener(
                        "scroll",
                        checkSlidePosition
                    )
                }
            } catch (err) {}
        }
    }, [])

    // Click away to close password input
    React.useEffect(() => {
        if (!showPasswordInput) return

        const handleClickOutside = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setShowPasswordInput(false)
                setPassword("")
                setPasswordError("")
            }
        }

        document.addEventListener("mousedown", handleClickOutside)
        return () =>
            document.removeEventListener("mousedown", handleClickOutside)
    }, [showPasswordInput])

    const handleEditClick = () => {
        setShowPasswordInput(true)
        setPasswordError("")
        setPassword("")
        // Focus input after render
        setTimeout(() => inputRef.current?.focus(), 100)
    }

    const handlePasswordSubmit = async () => {
        if (!password) {
            setPasswordError("Password required")
            return
        }

        setIsPressed(true)
        setIsTransitioning(true)

        try {
            const response = await fetch(
                "https://chat-backend-vert.vercel.app/api/getSlideForEdit",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        token:
                            props.token ||
                            new URLSearchParams(window.location.search).get(
                                "token"
                            ),
                        password,
                    }),
                }
            )

            if (!response.ok) {
                const error = await response.json()
                setPasswordError(error.error || "Invalid password")
                setIsTransitioning(false)
                setIsPressed(false)
                // Shake animation on error
                return
            }

            const data = await response.json()

            // Success - green checkmark
            await new Promise((resolve) => setTimeout(resolve, 400))

            // Store the edit data in sessionStorage so the edit page can access it
            // This ensures we don't lose the data during the redirect
            if (typeof window !== "undefined") {
                const token =
                    props.token ||
                    new URLSearchParams(window.location.search).get("token")

                // Store the complete slide data in sessionStorage
                sessionStorage.setItem("editSlideData", JSON.stringify(data))

                console.log(
                    "[PublishedSlideFrame] Stored edit data in sessionStorage:",
                    data
                )

                // Redirect to edit page
                window.location.href = `https://www.selfrun.ai/agentpitch/published/edit?token=${token}`
            }
        } catch (error) {
            console.error("[PublishedSlideFrame] Edit error:", error)
            setPasswordError("Failed to load slide for editing")
            setIsTransitioning(false)
            setIsPressed(false)
        }
    }

    if (loading) {
        return (
            <div className="publishedSlideRoot">
                <style>{CSS}</style>
                <div className="loadingContainer">Loading presentation...</div>
            </div>
        )
    }

    if (!htmlContent) {
        return (
            <div className="publishedSlideRoot">
                <style>{CSS}</style>
                <div className="loadingContainer">
                    <h2 className="loadingTitle">No presentation found</h2>
                </div>
            </div>
        )
    }

    const showButton = password.length > 0

    // Render the HTML directly in an iframe using srcdoc
    return (
        <div className="publishedSlideRoot">
            <style>{CSS}</style>

            {/* WATERMARK: Hidden on first slide, visible on all other slides.
                Controlled by ONE simple JavaScript function that checks scroll position. */}
            <img
                src="https://w24qls9w8lqauhdf.public.blob.vercel-storage.com/HB-Star.png"
                alt=""
                className="hb-watermark"
                aria-hidden="true"
            />

            {/* Elegant Edit Button that transforms into password input - only on first/last slide AND not BrandRadar */}
            {isOnFirstOrLastSlide && !isBrandRadar && (
                <div className="editButtonContainer">
                    {/* Refresh Button - HIDDEN */}
                    {/* <button
                        className="refreshButton"
                        onClick={() => {
                            console.log('[PublishedSlideFrame] Manual refresh triggered')
                            setRefreshKey(prev => prev + 1)
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.08)"
                            e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"
                            e.currentTarget.style.color = "rgba(237,234,234,0.9)"
                            e.currentTarget.style.transform = "translateY(-2px)"
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.06)"
                            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"
                            e.currentTarget.style.color = "rgba(237,234,234,0.7)"
                            e.currentTarget.style.transform = "translateY(0)"
                        }}
                        title="Refresh to see latest changes"
                    >
                        <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>
                    </button> */}

                    {/* Edit Button Container */}
                    <div
                        ref={containerRef}
                        style={{
                            opacity: showPasswordInput ? 1 : 0.8,
                            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                            transform: showPasswordInput
                                ? "scale(1)"
                                : "scale(0.98)",
                        }}
                    >
                        {!showPasswordInput ? (
                            // Minimal Edit Button
                            <button
                                className="editButton"
                                onClick={handleEditClick}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background =
                                        "rgba(255,255,255,0.08)"
                                    e.currentTarget.style.borderColor =
                                        "rgba(255,255,255,0.15)"
                                    e.currentTarget.style.color =
                                        "rgba(237,234,234,0.9)"
                                    e.currentTarget.style.transform =
                                        "translateY(-2px)"
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background =
                                        "rgba(255,255,255,0.06)"
                                    e.currentTarget.style.borderColor =
                                        "rgba(255,255,255,0.1)"
                                    e.currentTarget.style.color =
                                        "rgba(237,234,234,0.7)"
                                    e.currentTarget.style.transform =
                                        "translateY(0)"
                                }}
                            >
                                <svg
                                    className="icon-sm"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                                <span>Edit</span>
                            </button>
                        ) : (
                            // Transform into password input
                            <div
                                className={`passwordInputContainer ${passwordError ? "error" : ""}`}
                            >
                                <input
                                    ref={inputRef}
                                    type="password"
                                    placeholder="Enter Password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value)
                                        setPasswordError("")
                                    }}
                                    disabled={isTransitioning}
                                    className={`passwordInput ${showButton ? "hasButton" : ""}`}
                                    onKeyPress={(e) => {
                                        if (e.key === "Enter" && password) {
                                            handlePasswordSubmit()
                                        }
                                    }}
                                />

                                {showButton && (
                                    <button
                                        onClick={handlePasswordSubmit}
                                        disabled={isTransitioning}
                                        className={`submitButton ${passwordError ? "error" : "success"} ${isPressed ? "pressed" : ""}`}
                                        onMouseEnter={(e) => {
                                            if (!isTransitioning) {
                                                e.currentTarget.style.transform =
                                                    "translateY(-50%) scale(1.05)"
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform =
                                                "translateY(-50%) scale(1)"
                                        }}
                                    >
                                        {isTransitioning ? (
                                            <svg
                                                className="icon-md"
                                                viewBox="0 0 20 20"
                                                fill="none"
                                            >
                                                <path
                                                    d="M4 10L8 14L16 6"
                                                    stroke="white"
                                                    strokeWidth="2.5"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        ) : passwordError ? (
                                            "Wrong"
                                        ) : (
                                            "Go"
                                        )}
                                    </button>
                                )}

                                {passwordError && (
                                    <div className="passwordError">
                                        {passwordError}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <iframe
                ref={iframeRef}
                srcDoc={htmlContent}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    border: "none",
                    background: "transparent",
                    backgroundColor: "transparent",
                }}
                title="Published Presentation"
                sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox"
                allowTransparency={true}
            />
        </div>
    )
}

// Framer property controls
addPropertyControls(PublishedSlideFrame, {
    token: {
        type: ControlType.String,
        title: "Token",
        description: "The presentation token. Leave empty to read from URL.",
        defaultValue: "",
    },
})
