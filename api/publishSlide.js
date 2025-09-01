// PublishedSlideFrame.tsx - Framer Code Component for viewing published slides
import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

export default function PublishedSlideFrame(props: { token?: string }) {
    const [mounted, setMounted] = React.useState(false)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [slideUrl, setSlideUrl] = React.useState<string | null>(null)
    const [extractedToken, setExtractedToken] = React.useState<string | null>(null)
    
    // Handle mounting
    React.useEffect(() => {
        setMounted(true)
    }, [])
    
    // Get token and construct URL
    React.useEffect(() => {
        if (!mounted) return
        
        let finalToken = props.token || ""
        
        // If no prop token, try to get from URL
        if (!finalToken && typeof window !== "undefined") {
            // Try query params first
            const urlParams = new URLSearchParams(window.location.search)
            const queryToken = urlParams.get('token')
            
            if (queryToken) {
                finalToken = queryToken
            } else {
                // Try path patterns
                const path = window.location.pathname
                
                // Check for ?token=xxx in hash (sometimes Framer does this)
                if (window.location.hash.includes('token=')) {
                    const hashParams = new URLSearchParams(window.location.hash.substring(1))
                    const hashToken = hashParams.get('token')
                    if (hashToken) finalToken = hashToken
                }
                
                // Check for /published/xxx pattern
                const match = path.match(/\/published\/([a-zA-Z0-9]+)/)
                if (match && match[1]) {
                    finalToken = match[1]
                }
            }
        }
        
        if (!finalToken) {
            setError("No presentation token found")
            setLoading(false)
            return
        }
        
        // Save the token for display
        setExtractedToken(finalToken)
        
        // Try to get the blob URL from localStorage first
        let blobUrl = null
        
        if (typeof window !== "undefined") {
            const slideMappings = JSON.parse(localStorage.getItem('slideMappings') || '{}')
            if (slideMappings[finalToken]) {
                blobUrl = slideMappings[finalToken]
                console.log('Found blob URL in localStorage:', blobUrl)
            }
        }
        
        // If not found in localStorage, use the API endpoint that serves HTML properly
        if (!blobUrl) {
            // Use the viewSlide API endpoint which serves HTML with correct headers
            blobUrl = `https://agentpitch.vercel.app/api/viewSlide?token=${finalToken}`
        }
        
        // Verify the slide exists
        fetch(blobUrl, { method: 'HEAD', mode: 'no-cors' })
            .then(() => {
                setSlideUrl(blobUrl)
                setLoading(false)
            })
            .catch(() => {
                // Even if HEAD fails due to CORS, try to load it anyway
                // as iframes can sometimes load content that fetch cannot
                setSlideUrl(blobUrl)
                setLoading(false)
            })
            
    }, [mounted, props.token])
    
    // Don't render anything until mounted (avoids SSR issues)
    if (!mounted) {
        return null
    }
    
    if (loading) {
        return (
            <div style={{
                width: "100%",
                height: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                color: "#EDEAEA",
                fontSize: "1.5rem",
                fontFamily: "Inter, system-ui, sans-serif"
            }}>
                Loading presentation...
            </div>
        )
    }
    
    if (error || !slideUrl) {
        return (
            <div style={{
                width: "100%",
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                color: "#EDEAEA",
                fontFamily: "Inter, system-ui, sans-serif",
                textAlign: "center",
                padding: "2rem"
            }}>
                <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>
                    Presentation Not Found
                </h1>
                <p style={{ opacity: 0.8, marginBottom: "2rem" }}>
                    {error || "The presentation could not be loaded"}
                </p>
                <p style={{ opacity: 0.6, fontSize: "0.9rem" }}>
                    URL: {typeof window !== "undefined" ? window.location.href : ""}
                </p>
            </div>
        )
    }
    
    // Render the slide in an iframe
    return (
        <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            overflow: "hidden"
        }}>
            <iframe
                src={slideUrl}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    border: "none",
                    margin: 0,
                    padding: 0,
                    background: "white"
                }}
                title="Published Presentation"
                allow="fullscreen"
            />
            
            {/* Debug info - remove this after testing */}
            <div style={{
                position: "absolute",
                bottom: 10,
                right: 10,
                background: "rgba(0,0,0,0.8)",
                color: "white",
                padding: "5px 10px",
                borderRadius: 5,
                fontSize: "12px",
                fontFamily: "monospace",
                zIndex: 1000,
                maxWidth: "400px",
                wordBreak: "break-all"
            }}>
                Token: {extractedToken || 'none'}<br/>
                URL: {slideUrl}<br/>
                <a href={slideUrl} target="_blank" rel="noopener" style={{color: "#3F8CFF", textDecoration: "underline"}}>Open directly</a>
            </div>
        </div>
    )
}

// Framer property controls
addPropertyControls(PublishedSlideFrame, {
    token: {
        type: ControlType.String,
        title: "Token",
        description: "The presentation token (e.g., '7adc42b7'). Leave empty to read from URL.",
        defaultValue: ""
    }
})
