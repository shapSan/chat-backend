import React, { useState, useEffect, useRef } from "react"
import { useTranslation, LANGUAGES } from "./useTranslation.ts"
import { LanguageDropdown } from "./LanguageDropdown.tsx"

/* ──────────────────────────────────────────────────────────────────
   Liquid Glass (2030) — shared tokens + fonts (same as editor)
   ────────────────────────────────────────────────────────────────── */
const LG_CSS = `
:root{
  --ink:#F2F2F2; --muted:rgba(242,242,242,.64);
  --hairline:rgba(255,255,255,.08);
  --glass-1:rgba(20,22,26,.58);
  --glass-2:rgba(16,18,22,.42);
  --inner-hi:rgba(255,255,255,.06);
  --inner-lo:rgba(0,0,0,.28);

  --champagne:#D8C586; --champagne-ink:#E9DCB1;
  --ring:rgba(216,197,134,.28);

  --radius-sm:10px; --radius:16px; --radius-lg:20px;
  --shadow:0 18px 40px rgba(0,0,0,.45), 0 2px 10px rgba(0,0,0,.22);
  --shadow-soft:0 10px 26px rgba(0,0,0,.28);
  --ease:cubic-bezier(.4,0,.2,1);
}
:where(button,a,input,select,textarea,[contenteditable]):focus-visible{
  outline:2px solid var(--ring); outline-offset:2px;
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`

let _lgInjected = false
function ensureLG() {
    if (_lgInjected) return
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href =
        "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap"
    document.head.appendChild(link)
    const style = document.createElement("style")
    style.textContent = LG_CSS
    document.head.appendChild(style)
    _lgInjected = true
}

/* ──────────────────────────────────────────────────────────────────
   Types / Icons
   ────────────────────────────────────────────────────────────────── */
interface Slide {
    id: string
    type: "title" | "about" | "services" | "portfolio" | "team" | "contact"
    content: {
        title?: string
        subtitle?: string
        body?: string
        items?: string[]
    }
}

const XIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
)
const PlusIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
)
const DownloadIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
)
const BoldIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
        <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
    </svg>
)
const ItalicIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <line x1="19" y1="4" x2="10" y2="4"></line>
        <line x1="14" y1="20" x2="5" y2="20"></line>
        <line x1="15" y1="4" x2="9" y2="20"></line>
    </svg>
)
const TypeIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <polyline points="4 7 4 4 20 4 20 7"></polyline>
        <line x1="9" y1="20" x2="15" y2="20"></line>
        <line x1="12" y1="4" x2="12" y2="20"></line>
    </svg>
)
const PaletteIcon = () => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <circle cx="13.5" cy="6.5" r=".5"></circle>
        <circle cx="17.5" cy="10.5" r=".5"></circle>
        <circle cx="8.5" cy="7.5" r=".5"></circle>
        <circle cx="6.5" cy="12.5" r=".5"></circle>
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
    </svg>
)

/* ──────────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────────── */
// Publishing state interface
interface PublishState {
    isPublishing: boolean
    publishedUrl: string | null
    token: string | null
    lastPublished: Date | null
}

const SlidesEditor: React.FC = () => {
    ensureLG()

    const [isVisible, setIsVisible] = useState(false)
    const [showAddMenu, setShowAddMenu] = useState(false)
    const { currentLang, isTranslating, translateTexts } = useTranslation()
    const [publishState, setPublishState] = useState<PublishState>({
        isPublishing: false,
        publishedUrl: null,
        token: null,
        lastPublished: null,
    })
    const [showPublishSuccess, setShowPublishSuccess] = useState(false)
    const [slides, setSlides] = useState<Slide[]>([
        {
            id: "1",
            type: "title",
            content: {
                title: "HOLLYWOOD BRANDED",
                subtitle: "Crafting Cultural Excellence",
            },
        },
        {
            id: "2",
            type: "about",
            content: {
                title: "About Us",
                body: "We build culturally fluent brand experiences across screens and streams.",
            },
        },
        {
            id: "3",
            type: "services",
            content: {
                title: "Our Services",
                items: [
                    "Web Design",
                    "Brand Strategy",
                    "Digital Marketing",
                    "Content Creation",
                ],
            },
        },
        {
            id: "4",
            type: "portfolio",
            content: {
                title: "Recent Work",
                subtitle: "Projects that inspire",
            },
        },
        {
            id: "5",
            type: "team",
            content: {
                title: "Meet Our Team",
                body: "Passionate professionals dedicated to your success",
            },
        },
        {
            id: "6",
            type: "contact",
            content: {
                title: "Get In Touch",
                body: "hello@yourbrand.com\n+1 (555) 123-4567",
            },
        },
    ])
    const [selectedSlide, setSelectedSlide] = useState<string | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [draggedSlide, setDraggedSlide] = useState<string | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        editorInstance = {
            show: () => {
                setIsVisible(true)
                window.dispatchEvent(new CustomEvent("HB:slides-open"))
            },
            hide: () => {
                setIsVisible(false)
                window.dispatchEvent(new CustomEvent("HB:slides-close"))
            },
        }
        if (typeof window !== "undefined")
            (window as any).SlidesEditorInstance = editorInstance

        return () => {
            editorInstance = null
            if (typeof window !== "undefined")
                delete (window as any).SlidesEditorInstance
        }
    }, [])

    const handleSlideEdit = (slideId: string, field: string, value: string) => {
        setSlides(
            slides.map((s) =>
                s.id === slideId
                    ? { ...s, content: { ...s.content, [field]: value } }
                    : s
            )
        )
    }
    const handleItemEdit = (slideId: string, index: number, value: string) => {
        setSlides(
            slides.map((s) => {
                if (s.id === slideId && s.content.items) {
                    const items = [...s.content.items]
                    items[index] = value
                    return { ...s, content: { ...s.content, items } }
                }
                return s
            })
        )
    }
    const addSlide = (type: Slide["type"]) => {
        const defaults: Record<Slide["type"], any> = {
            title: {
                title: "New Title Slide",
                subtitle: "Add your subtitle here",
            },
            about: { title: "About", body: "Tell your story here..." },
            services: {
                title: "Services",
                items: ["Service 1", "Service 2", "Service 3"],
            },
            portfolio: { title: "Portfolio", subtitle: "Showcase your work" },
            team: { title: "Team", body: "Introduce your team members" },
            contact: { title: "Contact", body: "your@email.com" },
        }
        setSlides([
            ...slides,
            { id: Date.now().toString(), type, content: defaults[type] },
        ])
        setShowAddMenu(false)
    }
    const deleteSlide = (slideId: string) => {
        if (slides.length <= 1) return
        setSlides(slides.filter((s) => s.id !== slideId))
        if (selectedSlide === slideId) setSelectedSlide(null)
    }
    const handleDragStart = (id: string) => {
        setIsDragging(true)
        setDraggedSlide(id)
    }
    const handleDragOver = (e: React.DragEvent, targetId: string) => {
        e.preventDefault()
        if (!draggedSlide || draggedSlide === targetId) return
        const a = slides.findIndex((s) => s.id === draggedSlide)
        const b = slides.findIndex((s) => s.id === targetId)
        if (a === -1 || b === -1) return
        const copy = [...slides]
        const [m] = copy.splice(a, 1)
        copy.splice(b, 0, m)
        setSlides(copy)
    }
    const handleDragEnd = () => {
        setIsDragging(false)
        setDraggedSlide(null)
    }
    const exportToPDF = () => alert("Export to PDF would be implemented here")

    // Load saved publish state from localStorage
    useEffect(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("slidePublishToken")
            if (stored) {
                try {
                    const data = JSON.parse(stored)
                    setPublishState(prev => ({
                        ...prev,
                        ...data,
                        lastPublished: data.lastPublished ? new Date(data.lastPublished) : null
                    }))
                } catch {}
            }
        }
    }, [])

    // Generate a session ID (you might already have this from your app)
    const getSessionId = () => {
        if (typeof window === "undefined") return "default"
        let sessionId = sessionStorage.getItem("agentPitchSessionId")
        if (!sessionId) {
            sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            sessionStorage.setItem("agentPitchSessionId", sessionId)
        }
        return sessionId
    }

    const handlePublish = async () => {
        setPublishState(prev => ({ ...prev, isPublishing: true }))
        
        try {
            const sessionId = getSessionId()
            
            // Basic check
            if (!slides || slides.length === 0) {
                throw new Error('No slides to publish')
            }
            
            // Call your backend API - using the correct deployed URL
            const apiUrl = "https://chat-backend-vert.vercel.app/api/publishSlide"
            
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    slides,
                    title: slides[0]?.content?.title || "Agent Pitch Presentation",
                    updateExisting: !!publishState.token
                })
            })
            
            if (!response.ok) {
                throw new Error(`Failed to publish (${response.status})`)
            }
            
            const data = await response.json()
            
            if (!data.success) {
                throw new Error(data.error || 'Publishing failed')
            }
            
            // Update state
            const newState = {
                publishedUrl: data.url,
                token: data.token,
                lastPublished: new Date(),
                isPublishing: false
            }
            
            setPublishState(prev => ({ ...prev, ...newState }))
            
            // Save to localStorage
            if (typeof window !== "undefined") {
                localStorage.setItem("slidePublishToken", JSON.stringify({
                    publishedUrl: data.url,
                    token: data.token,
                    lastPublished: new Date().toISOString()
                }))
            }
            
            // Store the blob URL mapping locally
            if (typeof window !== "undefined" && data.blobUrl) {
                const slideMapping = JSON.parse(localStorage.getItem('slideMappings') || '{}')
                slideMapping[data.token] = data.blobUrl
                localStorage.setItem('slideMappings', JSON.stringify(slideMapping))
            }
            
            setShowPublishSuccess(true)
            setTimeout(() => setShowPublishSuccess(false), 5000)
            
        } catch (error) {
            console.error("Publish failed:", error)
            alert(error.message || "Failed to publish slides. Please try again.")
            setPublishState(prev => ({ ...prev, isPublishing: false }))
        }
    }

    const copyToClipboard = (text: string) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text)
            // Visual feedback
            const btn = document.querySelector(".copy-btn")
            if (btn) {
                const original = btn.textContent
                btn.textContent = "Copied!"
                setTimeout(() => {
                    btn.textContent = original
                }, 2000)
            }
        }
    }

    const handleTranslateSlides = async (targetLang: string) => {
        if (targetLang === currentLang) return

        // Collect all texts and keep track of where they go
        const textsToTranslate: string[] = []
        const textMap: any[] = []

        slides.forEach((slide) => {
            if (slide.content.title) {
                textsToTranslate.push(slide.content.title)
                textMap.push({ slideId: slide.id, field: "title" })
            }
            if (slide.content.subtitle) {
                textsToTranslate.push(slide.content.subtitle)
                textMap.push({ slideId: slide.id, field: "subtitle" })
            }
            if (slide.content.body) {
                textsToTranslate.push(slide.content.body)
                textMap.push({ slideId: slide.id, field: "body" })
            }
            if (slide.content.items) {
                slide.content.items.forEach((item, idx) => {
                    textsToTranslate.push(item)
                    textMap.push({
                        slideId: slide.id,
                        field: "items",
                        index: idx,
                    })
                })
            }
        })

        // Get translations
        const translated = await translateTexts(textsToTranslate, targetLang)

        // Map back to slides
        const updatedSlides = [...slides]
        textMap.forEach((map, index) => {
            const slide = updatedSlides.find((s) => s.id === map.slideId)
            if (slide && translated[index]) {
                if (map.field === "items" && map.index !== undefined) {
                    if (slide.content.items) {
                        slide.content.items[map.index] = translated[index]
                    }
                } else {
                    ;(slide.content as any)[map.field] = translated[index]
                }
            }
        })

        setSlides(updatedSlides)
    }

    const renderSlideContent = (slide: Slide) => {
        const isSelected = selectedSlide === slide.id
        return (
            <div
                key={slide.id}
                style={{
                    aspectRatio: "16 / 9",
                    maxWidth: "min(1200px, calc(100vw - 48px))",
                    width: "calc(100% - 48px)",
                    margin: "0 auto",
                    height: "auto",
                    position: "relative",
                }}
            >
                <div
                    draggable
                    onDragStart={() => handleDragStart(slide.id)}
                    onDragOver={(e) => handleDragOver(e, slide.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => setSelectedSlide(slide.id)}
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        background: "rgba(26, 26, 26, 0.4)",
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                        borderRadius: 18,
                        padding: slide.type === "title" ? "6%" : "4% 6%",
                        boxShadow: "0 25px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.05)",
                        cursor: isDragging ? "grabbing" : "grab",
                        border: isSelected
                            ? "1px solid rgba(245,182,66,0.4)"
                            : "1px solid rgba(255,255,255,0.12)",
                        outline: isSelected
                            ? "2px solid rgba(245,182,66,.35)"
                            : "none",
                        display: "flex",
                        alignItems: "center",
                        transition:
                            "outline .18s var(--ease), box-shadow .18s var(--ease)",
                        opacity: draggedSlide === slide.id ? 0.55 : 1,
                        fontFamily: "Inter, system-ui",
                        color: "#EDEAEA",
                    }}
                >
                    {isSelected && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                deleteSlide(slide.id)
                            }}
                            style={{
                                position: "absolute",
                                top: "3%",
                                right: "3%",
                                background:
                                    "linear-gradient(180deg, rgba(255,80,80,.95), rgba(200,40,40,.95))",
                                color: "#fff",
                                border: "1px solid rgba(255,255,255,.2)",
                                borderRadius: 10,
                                padding: "6px 10px",
                                cursor: "pointer",
                                fontSize: "12px",
                                boxShadow: "0 8px 18px rgba(0,0,0,.18)",
                                zIndex: 10,
                            }}
                        >
                            Delete
                        </button>
                    )}

                    {slide.type === "title" ? (
                        // Title slide - centered
                        <div style={{
                            width: "100%",
                            textAlign: "center",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            alignItems: "center",
                            height: "100%"
                        }}>
                            {slide.content.title && (
                                <h1
                                    contentEditable={isSelected}
                                    suppressContentEditableWarning
                                    onBlur={(e) =>
                                        handleSlideEdit(
                                            slide.id,
                                            "title",
                                            e.currentTarget.textContent || ""
                                        )
                                    }
                                    style={{
                                        fontFamily: "ui-sans-serif, system-ui",
                                        fontSize: "clamp(2.5rem, 7vw, 5rem)",
                                        fontWeight: 900,
                                        letterSpacing: "0.02em",
                                        textTransform: "uppercase",
                                        color: "#EDEAEA",
                                        margin: 0,
                                        marginBottom: "0.3em",
                                        outline: "none",
                                        minHeight: "1em",
                                        cursor: "text",
                                        lineHeight: 0.98,
                                    }}
                                >
                                    {slide.content.title}
                                </h1>
                            )}
                            {slide.content.subtitle && (
                                <h2
                                    contentEditable={isSelected}
                                    suppressContentEditableWarning
                                    onBlur={(e) =>
                                        handleSlideEdit(
                                            slide.id,
                                            "subtitle",
                                            e.currentTarget.textContent || ""
                                        )
                                    }
                                    style={{
                                        fontFamily: "ui-monospace, Menlo, monospace",
                                        fontSize: "clamp(0.9rem, 2vw, 1.4rem)",
                                        fontWeight: 400,
                                        color: "rgba(237,234,234,0.9)",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.08em",
                                        margin: 0,
                                        outline: "none",
                                        cursor: "text",
                                    }}
                                >
                                    {slide.content.subtitle}
                                </h2>
                            )}
                        </div>
                    ) : (
                        // Regular slide - grid with media panel
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "1.1fr 1fr",
                            gap: "5%",
                            alignItems: "center",
                            width: "100%",
                            height: "100%"
                        }}>
                            {/* Left: Content */}
                            <div>
                                {slide.type && (
                                    <div style={{
                                        fontSize: "clamp(0.7rem, 1.2vw, 0.9rem)",
                                        letterSpacing: "0.12em",
                                        color: "rgba(237,234,234,0.7)",
                                        textTransform: "uppercase",
                                        marginBottom: "8px",
                                        fontFamily: "ui-monospace, Menlo, monospace"
                                    }}>
                                        Slide {slides.indexOf(slide) + 1}: {slide.type.charAt(0).toUpperCase() + slide.type.slice(1)}
                                    </div>
                                )}
                                {slide.content.title && (
                                    <h2
                                        contentEditable={isSelected}
                                        suppressContentEditableWarning
                                        onBlur={(e) =>
                                            handleSlideEdit(
                                                slide.id,
                                                "title",
                                                e.currentTarget.textContent || ""
                                            )
                                        }
                                        style={{
                                            fontFamily: "ui-sans-serif, system-ui",
                                            fontSize: "clamp(1.8rem, 4.5vw, 3.5rem)",
                                            fontWeight: 900,
                                            textTransform: "uppercase",
                                            color: "#EDEAEA",
                                            marginBottom: "0.3em",
                                            lineHeight: 0.98,
                                            letterSpacing: "0.02em",
                                            outline: "none",
                                            cursor: "text",
                                            margin: 0,
                                        }}
                                    >
                                        {slide.content.title}
                                    </h2>
                                )}
                                {slide.content.subtitle && (
                                    <div
                                        contentEditable={isSelected}
                                        suppressContentEditableWarning
                                        onBlur={(e) =>
                                            handleSlideEdit(
                                                slide.id,
                                                "subtitle",
                                                e.currentTarget.textContent || ""
                                            )
                                        }
                                        style={{
                                            fontSize: "clamp(0.8rem, 1.4vw, 1rem)",
                                            color: "rgba(237,234,234,0.9)",
                                            textTransform: "uppercase",
                                            marginBottom: "1em",
                                            letterSpacing: "0.08em",
                                            fontFamily: "ui-monospace, Menlo, monospace",
                                            outline: "none",
                                            cursor: "text",
                                        }}
                                    >
                                        {slide.content.subtitle}
                                    </div>
                                )}
                                {slide.content.body && (
                                    <p
                                        contentEditable={isSelected}
                                        suppressContentEditableWarning
                                        onBlur={(e) =>
                                            handleSlideEdit(
                                                slide.id,
                                                "body",
                                                e.currentTarget.textContent || ""
                                            )
                                        }
                                        style={{
                                            fontSize: "clamp(0.85rem, 1.6vw, 1.2rem)",
                                            lineHeight: 1.65,
                                            color: "rgba(237,234,234,0.96)",
                                            whiteSpace: "pre-wrap",
                                            outline: "none",
                                            minHeight: "1.5em",
                                            cursor: "text",
                                            margin: 0,
                                            marginBottom: "1em",
                                        }}
                                    >
                                        {slide.content.body}
                                    </p>
                                )}
                                {slide.content.items && (
                                    <ul
                                        style={{
                                            fontSize: "clamp(0.85rem, 1.6vw, 1.2rem)",
                                            lineHeight: 1.8,
                                            color: "rgba(237,234,234,0.96)",
                                            paddingLeft: 0,
                                            listStyle: "none",
                                            cursor: "text",
                                            margin: 0,
                                        }}
                                    >
                                        {slide.content.items.map((item, index) => (
                                            <li
                                                key={index}
                                                style={{
                                                    position: "relative",
                                                    paddingLeft: "1.2em",
                                                    marginBottom: "0.5em",
                                                    outline: "none",
                                                }}
                                            >
                                                <span style={{
                                                    position: "absolute",
                                                    left: 0,
                                                    color: "#F5B642"
                                                }}>•</span>
                                                <span
                                                    contentEditable={isSelected}
                                                    suppressContentEditableWarning
                                                    onBlur={(e) =>
                                                        handleItemEdit(
                                                            slide.id,
                                                            index,
                                                            e.currentTarget.textContent || ""
                                                        )
                                                    }
                                                >
                                                    {item}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            
                            {/* Right: Media Panel */}
                            <div style={{
                                position: "relative",
                                borderRadius: "16px",
                                border: "1px solid rgba(255,255,255,0.18)",
                                overflow: "hidden",
                                height: "100%",
                                minHeight: "250px",
                                background: "linear-gradient(135deg, rgba(245,182,66,0.1), rgba(63,140,255,0.1))",
                                backdropFilter: "blur(8px)",
                                boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center"
                            }}>
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(237,234,234,0.3)" strokeWidth="1.5">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                    <circle cx="8.5" cy="8.5" r="1.5"/>
                                    <polyline points="21 15 16 10 5 21"/>
                                </svg>
                                <p style={{
                                    marginTop: "8px",
                                    fontSize: "clamp(0.8rem, 1.4vw, 1rem)",
                                    fontWeight: 500,
                                    color: "rgba(237,234,234,0.3)"
                                }}>Media Panel</p>
                                <span style={{
                                    fontSize: "clamp(0.7rem, 1.2vw, 0.85rem)",
                                    opacity: 0.7,
                                    color: "rgba(237,234,234,0.25)"
                                }}>Images in published view</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    if (!isVisible) return null

    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                background: "transparent", // let parent bg show
                pointerEvents: "auto",
                zIndex: 1000,
                overflow: "auto",
            }}
        >
            {/* Floating Glass Header */}
            <div
                style={{
                    position: "sticky",
                    top: 16,
                    margin: "0 auto",
                    width: "min(1100px, 94%)",
                    background: "var(--glass-1)",
                    border: "1px solid var(--hairline)",
                    borderRadius: "16px",
                    boxShadow: "var(--shadow)",
                    backdropFilter: "saturate(1.05) blur(10px)",
                    WebkitBackdropFilter: "blur(10px)",
                    zIndex: 10,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        color: "var(--ink)",
                        fontFamily: "Inter, system-ui",
                    }}
                >
                    {/* Formatting group (non-functional placeholders, matched look) */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <button style={glassBtn()}>
                            <BoldIcon />
                        </button>
                        <button style={glassBtn()}>
                            <ItalicIcon />
                        </button>
                        <button style={glassBtn()}>
                            <TypeIcon />
                        </button>
                        <button style={glassBtn()}>
                            <PaletteIcon />
                        </button>
                    </div>

                    <div
                        style={{
                            height: 36,
                            width: 1,
                            background: "var(--hairline)",
                            margin: "0 6px",
                        }}
                    />

                    {/* Add Slide */}
                    <div style={{ position: "relative" }}>
                        <button
                            style={glassBtn({ padding: "8px 10px", gap: 6 })}
                            onClick={() => setShowAddMenu(!showAddMenu)}
                        >
                            <PlusIcon />
                            <span style={{ fontSize: 13 }}>Add Slide</span>
                        </button>
                        {showAddMenu && (
                            <div
                                style={{
                                    position: "absolute",
                                    top: "calc(100% + 6px)",
                                    left: 0,
                                    background: "var(--glass-2)",
                                    border: "1px solid var(--hairline)",
                                    borderRadius: 12,
                                    padding: 8,
                                    minWidth: 180,
                                    boxShadow: "var(--shadow-soft)",
                                    backdropFilter: "blur(8px)",
                                    zIndex: 1000,
                                }}
                            >
                                {[
                                    "title",
                                    "about",
                                    "services",
                                    "portfolio",
                                    "team",
                                    "contact",
                                ].map((t) => (
                                    <button
                                        key={t}
                                        onClick={() =>
                                            addSlide(t as Slide["type"])
                                        }
                                        style={{
                                            display: "block",
                                            width: "100%",
                                            textAlign: "left",
                                            padding: "10px 12px",
                                            background: "transparent",
                                            color: "var(--ink)",
                                            border: "1px solid transparent",
                                            borderRadius: 10,
                                            cursor: "pointer",
                                            fontFamily: "Inter, system-ui",
                                            fontSize: 13,
                                        }}
                                        onMouseEnter={(e) => {
                                            ;(
                                                e.currentTarget as HTMLButtonElement
                                            ).style.background =
                                                "rgba(255,255,255,.06)"
                                        }}
                                        onMouseLeave={(e) => {
                                            ;(
                                                e.currentTarget as HTMLButtonElement
                                            ).style.background = "transparent"
                                        }}
                                    >
                                        {t[0].toUpperCase() + t.slice(1)}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        style={glassBtn({ padding: "8px 10px", gap: 6 })}
                        onClick={exportToPDF}
                    >
                        <DownloadIcon />
                        <span style={{ fontSize: 13 }}>Export PDF</span>
                    </button>

                    {/* Publish Button */}
                    <button
                        style={{
                            ...glassBtn({ padding: "8px 10px", gap: 6 }),
                            background: publishState.isPublishing
                                ? "rgba(216, 197, 134, 0.2)"
                                : publishState.publishedUrl
                                ? "linear-gradient(180deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.25))"
                                : "linear-gradient(180deg, rgba(216, 197, 134, 0.1), rgba(216, 197, 134, 0.2))",
                        }}
                        onClick={handlePublish}
                        disabled={publishState.isPublishing}
                    >
                        <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                            <polyline points="16 6 12 2 8 6" />
                            <line x1="12" y1="2" x2="12" y2="15" />
                        </svg>
                        <span style={{ fontSize: 13 }}>
                            {publishState.isPublishing
                                ? "Publishing..."
                                : publishState.publishedUrl
                                ? "Update"
                                : "Publish"}
                        </span>
                    </button>

                    {/* Language Dropdown - Now using the reusable component */}
                    <LanguageDropdown
                        currentLang={currentLang}
                        isTranslating={isTranslating}
                        onLanguageSelect={handleTranslateSlides}
                        buttonStyle={glassBtn({ padding: "8px 10px", gap: 6 })}
                    />

                    <div style={{ marginLeft: "auto" }}>
                        <button
                            style={glassBtn()}
                            onClick={() => {
                                setIsVisible(false)
                                window.dispatchEvent(
                                    new CustomEvent("HB:slides-close")
                                )
                            }}
                        >
                            <XIcon />
                        </button>
                    </div>
                </div>
            </div>

            {/* Slides Grid */}
            <div
                ref={containerRef}
                onClick={() => {
                    setShowAddMenu(false)
                }}
                style={{
                    padding: "64px 0 80px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 40,
                    minHeight: "calc(100vh - 88px)",
                }}
            >
                {slides.map(renderSlideContent)}
            </div>

            {/* Publish Success Modal */}
            {showPublishSuccess && publishState.publishedUrl && (
                <div
                    style={{
                        position: "fixed",
                        bottom: 24,
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "var(--glass-1)",
                        border: "1px solid var(--hairline)",
                        borderRadius: 16,
                        padding: "16px 20px",
                        boxShadow: "var(--shadow)",
                        backdropFilter: "blur(10px)",
                        WebkitBackdropFilter: "blur(10px)",
                        zIndex: 1000,
                        minWidth: 320,
                        maxWidth: "90vw",
                        animation: "slideUp 0.3s ease-out",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            color: "var(--ink)",
                            fontFamily: "Inter, system-ui",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                fontSize: 14,
                                fontWeight: 600,
                            }}
                        >
                            <span style={{ color: "#22c55e" }}>✓</span>
                            Published Successfully!
                        </div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                background: "rgba(0,0,0,0.2)",
                                borderRadius: 10,
                                padding: "8px 12px",
                            }}
                        >
                            <input
                                type="text"
                                value={publishState.publishedUrl}
                                readOnly
                                style={{
                                    flex: 1,
                                    background: "transparent",
                                    border: "none",
                                    color: "var(--muted)",
                                    fontSize: 12,
                                    fontFamily: "monospace",
                                    outline: "none",
                                }}
                            />
                            <button
                                className="copy-btn"
                                onClick={() => copyToClipboard(publishState.publishedUrl!)}
                                style={{
                                    ...glassBtn(),
                                    padding: "4px 8px",
                                    fontSize: 11,
                                    minWidth: "auto",
                                    height: "auto",
                                }}
                            >
                                Copy
                            </button>
                            <a
                                href={publishState.publishedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    ...glassBtn(),
                                    padding: "4px 8px",
                                    fontSize: 11,
                                    minWidth: "auto",
                                    height: "auto",
                                    textDecoration: "none",
                                    display: "inline-flex",
                                }}
                            >
                                Open
                            </a>
                        </div>
                        {publishState.lastPublished && (
                            <div
                                style={{
                                    fontSize: 11,
                                    color: "var(--muted)",
                                    opacity: 0.7,
                                }}
                            >
                                Last updated: {publishState.lastPublished.toLocaleString()}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                @keyframes slideUp {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
            `}</style>
        </div>
    )
}

/* Small helper for consistent glass buttons */
function glassBtn(overrides: React.CSSProperties = {}): React.CSSProperties {
    return {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        padding: "8px",
        minWidth: 36,
        height: 36,
        color: "var(--ink)",
        background:
            "linear-gradient(180deg, rgba(255,255,255,.02), rgba(0,0,0,.10))",
        border: "1px solid var(--hairline)",
        borderRadius: 12,
        cursor: "pointer",
        transition: "all .18s var(--ease)",
        boxShadow:
            "inset 0 1px 0 var(--inner-hi), inset 0 -1px 0 var(--inner-lo)",
        ...overrides,
    }
}

/* ──────────────────────────────────────────────────────────────────
   Singleton plumbing (unchanged)
   ────────────────────────────────────────────────────────────────── */
let editorInstance: { show: () => void; hide: () => void } | null = null

if (typeof window !== "undefined") {
    ;(window as any).SlidesEditorInstance = {
        show: () => {
            if (editorInstance) editorInstance.show()
            else console.log("SlidesEditor instance not ready yet")
        },
        hide: () => {
            if (editorInstance) editorInstance.hide()
        },
    }
}

const SlidesEditorWrapper: React.FC = () => {
    const [mounted, setMounted] = useState(false)
    useEffect(() => {
        setMounted(true)
    }, [])
    if (!mounted) return null
    return <SlidesEditor />
}

export default SlidesEditorWrapper
