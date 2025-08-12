import * as React from "react"
import ReactMarkdown from "react-markdown"
import { addPropertyControls, ControlType } from "framer"
// @ts-ignore
import { BrandCard, BrandsSection, StyledSection } from "./BrandComponents.tsx"

interface Message {
    id: string
    sender: "user" | "assistant"
    content: string
    timestamp?: Date
    status?: "sending" | "sent" | "error"
    mcpSteps?: { text: string; timestamp: number; type?: string }[]
    activityMeta?: {
        meetings?: Array<{
            title: string
            date?: string
            url?: string
            participants?: string[]
            topics?: string[]
        }>
        emails?: Array<{
            subject: string
            date?: string
            from?: string
            to?: string[]
            summary?: string
        }>
        keyContacts?: string[]
    }
}

interface ProjectDetails {
    projectName: string
    cast: string
    location: string
    vibe: string
}

const styles = {
    suggestionButton: {
        padding: "8px 16px",
        backgroundColor: "rgba(255, 255, 255, 0.8)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(255, 255, 255, 0.3)",
        borderRadius: "20px",
        fontSize: "13px",
        fontWeight: "500",
        color: "#333",
        cursor: "pointer",
        whiteSpace: "nowrap" as const,
        transition: "all 0.2s ease",
        fontFamily: "'Manrope', sans-serif",
        minHeight: "36px",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
    },
    tooltip: {
        position: "absolute" as const,
        bottom: "100%",
        left: "50%",
        transform: "translateX(-50%)",
        marginBottom: "8px",
        padding: "6px 12px",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        color: "white",
        borderRadius: "6px",
        fontSize: "11px",
        whiteSpace: "nowrap" as const,
        opacity: "0",
        visibility: "hidden" as const,
        transition: "all 0.2s ease",
        pointerEvents: "none" as const,
        zIndex: 9999,
    },
}

const MCPDisplay = ({
    mcpSteps,
    isProcessing = false,
    showByDefault = false,
    style = {},
}: {
    mcpSteps: { text: string; timestamp: number; type?: string }[]
    isProcessing?: boolean
    showByDefault?: boolean
    style?: React.CSSProperties
}) => {
    const [showMcp, setShowMcp] = React.useState(showByDefault)
    const [isClosing, setIsClosing] = React.useState(false)

    React.useEffect(() => {
        if (showByDefault && mcpSteps.length > 0) {
            setShowMcp(true)
            setIsClosing(false)
        }
        // Auto-close when steps are cleared (processing complete)
        if (mcpSteps.length === 0 && showMcp) {
            setIsClosing(true)
            setTimeout(() => {
                setShowMcp(false)
                setIsClosing(false)
            }, 300)
        }
    }, [showByDefault, mcpSteps.length])

    if (!mcpSteps || mcpSteps.length === 0) {
        if (!isClosing) return null
    }

    return (
        <div
            style={{
                width: "100%",
                maxWidth: "60%",
                marginBottom: "8px",
                transition: "all 0.3s ease-out",
                opacity: isClosing ? 0 : 1,
                transform: isClosing ? "scale(0.98)" : "scale(1)",
                ...style,
            }}
        >
            <button
                onClick={() => setShowMcp(!showMcp)}
                style={{
                    background: "rgba(0, 0, 0, 0.04)",
                    border: "1px solid rgba(0, 0, 0, 0.08)",
                    borderRadius: "6px",
                    padding: "6px 12px",
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    color: "#f5f5f5",
                    transition: "all 0.2s ease",
                    marginBottom: "4px",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(0, 0, 0, 0.06)"
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(0, 0, 0, 0.04)"
                }}
            >
                <span
                    style={{
                        fontSize: "10px",
                        transition: "transform 0.2s ease",
                        transform: showMcp ? "rotate(90deg)" : "rotate(0deg)",
                        opacity: 0.6,
                    }}
                >
                    ▶
                </span>
                MCP {isProcessing ? "Processing" : "Reasoning"} (
                {mcpSteps.length} steps)
                {isProcessing && mcpSteps.length > 0 && (
                    <span
                        style={{
                            display: "inline-block",
                            width: "5px",
                            height: "5px",
                            backgroundColor: "#22c55e",
                            borderRadius: "50%",
                            animation:
                                mcpSteps[mcpSteps.length - 1]?.type ===
                                "complete"
                                    ? "none"
                                    : "pulse 1s infinite",
                            opacity: 0.8,
                        }}
                    />
                )}
            </button>

            {showMcp && (
                <div
                    style={{
                        background: "rgba(0, 0, 0, 0.03)",
                        border: "1px solid rgba(0, 0, 0, 0.06)",
                        borderRadius: "6px",
                        padding: "10px",
                        fontSize: "11px",
                        fontFamily: "monospace",
                        animation: "expandIn 0.3s ease-out",
                        color: "#f5f5f5",
                        whiteSpace: "pre-wrap",
                        opacity: isClosing ? 0 : 1,
                        transition: "opacity 0.3s ease-out",
                    }}
                >
                    {mcpSteps.map((step, i) => {
                        if (
                            step &&
                            typeof step === "object" &&
                            "text" in step
                        ) {
                            const timestamp =
                                typeof step.timestamp === "number"
                                    ? (step.timestamp / 1000).toFixed(1)
                                    : "0.0"

                            return (
                                <div
                                    key={`mcp-${i}`}
                                    style={{
                                        marginBottom: "6px",
                                        color: "#f5f5f5",
                                        animation: "fadeInLine 0.3s ease-out",
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: "8px",
                                    }}
                                >
                                    <span
                                        style={{
                                            opacity: 0.5,
                                            minWidth: "35px",
                                        }}
                                    >
                                        [{timestamp}s]
                                    </span>
                                    <span
                                        style={{
                                            flex: 1,
                                            fontWeight:
                                                step.type === "complete"
                                                    ? "600"
                                                    : "normal",
                                        }}
                                    >
                                        {step.text || "Processing..."}
                                    </span>
                                </div>
                            )
                        }
                        if (typeof step === "string") {
                            return (
                                <div
                                    key={`mcp-${i}`}
                                    style={{
                                        marginBottom: "4px",
                                        color: "#f5f5f5",
                                        animation: "fadeInLine 0.3s ease-out",
                                    }}
                                >
                                    {step}
                                </div>
                            )
                        }
                        return null
                    })}
                </div>
            )}
        </div>
    )
}

const BrandPicker = ({
    brands,
    selectedBrands,
    onToggle,
    onClose,
    onSend,
    anchorElement,
    isPitchRequest = false,
    projectName = "",
}: {
    brands: any[]
    selectedBrands: Set<string>
    onToggle: (brandId: string) => void
    onClose: () => void
    onSend: () => void
    anchorElement?: HTMLElement | null
    isPitchRequest?: boolean
    projectName?: string
}) => {
    const [show, setShow] = React.useState(false)
    const [expandedBrand, setExpandedBrand] = React.useState<string | null>(
        null
    )
    const pickerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        setTimeout(() => {
            setShow(true)
        }, 10)

        const handleClickOutside = (e: MouseEvent) => {
            if (
                pickerRef.current &&
                !pickerRef.current.contains(e.target as Node)
            ) {
                onClose()
            }
        }

        setTimeout(() => {
            document.addEventListener("mousedown", handleClickOutside)
        }, 100)

        return () => {
            document.removeEventListener("mousedown", handleClickOutside)
        }
    }, [onClose])

    const position = { bottom: "100px", left: "20px" }

    const normalizeTag = (t: string) =>
        t
            .replace(/^([💰🔥🎭📧🚀💡✨]\s*)/, "")
            .replace("Active Big-Budget Client", "Big Budget")
            .replace("Vibe Match", "Genre Match")
            .replace("Recent Activity", "This Week")

    const getTagColor = (tag: string) => {
        const normalizedTag = normalizeTag(tag)
        // Check for multiple tags patterns
        if (normalizedTag.includes("High Engagement"))
            return { bg: "rgba(34, 197, 94, 0.1)", color: "#22c55e" }
        if (normalizedTag.includes("Medium Engagement"))
            return { bg: "rgba(251, 191, 36, 0.1)", color: "#fbbf24" }
        if (normalizedTag.includes("Low Engagement"))
            return { bg: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }
        if (normalizedTag.includes("Hot Lead"))
            return { bg: "rgba(255, 0, 0, 0.15)", color: "#ff0000" }
        if (normalizedTag.includes("Recent Meeting"))
            return { bg: "rgba(147, 51, 234, 0.15)", color: "#9333ea" }
        if (normalizedTag.includes("Big Budget"))
            return { bg: "rgba(34, 197, 94, 0.15)", color: "#22c55e" }
        if (normalizedTag.includes("Genre Match"))
            return { bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" }
        if (normalizedTag.includes("This Week"))
            return { bg: "rgba(251, 191, 36, 0.15)", color: "#fbbf24" }
        if (normalizedTag.includes("Email Thread"))
            return { bg: "rgba(99, 102, 241, 0.15)", color: "#6366f1" }
        if (normalizedTag.includes("Hot"))
            return { bg: "rgba(255, 0, 0, 0.1)", color: "#ff0000" }
        if (normalizedTag.includes("Recent"))
            return { bg: "rgba(0, 123, 255, 0.1)", color: "#007bff" }
        return { bg: "rgba(0, 0, 0, 0.1)", color: "#666" }
    }

    return (
        <>
            <div
                ref={pickerRef}
                style={{
                    position: "fixed",
                    bottom: position.bottom,
                    left: "20px",
                    right: "20px",
                    maxWidth: "600px",
                    maxHeight: "50vh",
                    backgroundColor: "#ffffff",
                    borderRadius: "16px",
                    overflow: "hidden",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
                    border: "1px solid #ddd",
                    zIndex: 10000,
                    opacity: show ? 1 : 0,
                    transform: show
                        ? "translateY(0) scale(1)"
                        : "translateY(20px) scale(0.95)",
                    transformOrigin: "bottom left",
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
            >
                <div
                    style={{
                        padding: "16px 20px",
                        borderBottom: "1px solid rgba(255, 255, 255, 0.3)",
                        backgroundColor: "rgba(255, 255, 255, 0.5)",
                    }}
                >
                    <h3
                        style={{
                            margin: "0 0 4px 0",
                            fontSize: "16px",
                            fontWeight: "600",
                            color: "#333",
                        }}
                    >
                        {isPitchRequest
                            ? `Pitch Deep-Dive Brands${projectName ? ` for ${projectName}` : ""}`
                            : `Select Brands${projectName ? ` for ${projectName}` : ""}`}
                    </h3>
                    <p
                        style={{
                            margin: 0,
                            fontSize: "13px",
                            color: "#666",
                        }}
                    >
                        {isPitchRequest
                            ? "Detailed pitch opportunities from your network"
                            : "Choose brands for pitch generation"}
                    </p>
                </div>

                <div
                    style={{
                        maxHeight: "calc(50vh - 140px)",
                        overflowY: "auto",
                        WebkitOverflowScrolling: "touch",
                    }}
                >
                    {brands.map((brand, index) => {
                        const isExpanded =
                            expandedBrand === (brand.id || brand.name)

                        return (
                            <div
                                key={brand.id || index}
                                style={{
                                    backgroundColor: selectedBrands.has(
                                        brand.id || brand.name
                                    )
                                        ? "rgba(160, 116, 26, 0.15)"
                                        : "rgba(255, 255, 255, 0.7)",
                                    transition: "all 0.15s ease",
                                    borderBottom:
                                        "1px solid rgba(0, 0, 0, 0.08)",
                                }}
                            >
                                <label
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        padding: "12px 20px",
                                        cursor: "pointer",
                                        gap: "16px",
                                    }}
                                    onClick={() =>
                                        onToggle(brand.id || brand.name)
                                    }
                                >
                                    <div style={{ flex: 1 }}>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "baseline",
                                                gap: "8px",
                                                marginBottom: "4px",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    fontSize: "14px",
                                                    fontWeight: "600",
                                                    color: "#666",
                                                }}
                                            >
                                                {index + 1}.
                                            </span>
                                            <div
                                                style={{
                                                    position: "relative",
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontSize: "15px",
                                                        fontWeight: "500",
                                                        color: brand.hubspotUrl
                                                            ? "#007bff"
                                                            : "#333",
                                                        cursor: brand.hubspotUrl
                                                            ? "pointer"
                                                            : "default",
                                                        textDecoration: "none",
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        if (brand.brandUrl) {
                                                            const googleIcon =
                                                                e.currentTarget.parentElement?.querySelector(
                                                                    ".google-icon"
                                                                )
                                                            if (googleIcon) {
                                                                googleIcon.style.opacity =
                                                                    "1"
                                                                googleIcon.style.visibility =
                                                                    "visible"
                                                            }
                                                        }
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        const googleIcon =
                                                            e.currentTarget.parentElement?.querySelector(
                                                                ".google-icon"
                                                            )
                                                        if (googleIcon) {
                                                            googleIcon.style.opacity =
                                                                "0"
                                                            googleIcon.style.visibility =
                                                                "hidden"
                                                        }
                                                    }}
                                                    onClick={(e) => {
                                                        if (brand.hubspotUrl) {
                                                            e.stopPropagation()
                                                            // Use window.location for better session handling
                                                            if (
                                                                e.metaKey ||
                                                                e.ctrlKey
                                                            ) {
                                                                // Cmd/Ctrl click - open in new tab
                                                                window.open(
                                                                    brand.hubspotUrl,
                                                                    "_blank",
                                                                    "noopener,noreferrer"
                                                                )
                                                            } else {
                                                                // Regular click - open in same tab
                                                                window.location.href =
                                                                    brand.hubspotUrl
                                                            }
                                                        }
                                                    }}
                                                >
                                                    {brand.name}
                                                </span>
                                                {brand.brandUrl && (
                                                    <span
                                                        className="google-icon"
                                                        style={{
                                                            marginLeft: "6px",
                                                            fontSize: "12px",
                                                            opacity: "0",
                                                            visibility:
                                                                "hidden",
                                                            transition:
                                                                "all 0.2s ease",
                                                            cursor: "pointer",
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            window.open(
                                                                brand.brandUrl,
                                                                "_blank"
                                                            )
                                                        }}
                                                    >
                                                        🔍
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {brand.reason && (
                                            <div
                                                style={{
                                                    fontSize: "13px",
                                                    color: "#555",
                                                    lineHeight: "1.4",
                                                    marginBottom: "6px",
                                                }}
                                            >
                                                {brand.reason}
                                            </div>
                                        )}

                                        <div
                                            style={{
                                                display: "flex",
                                                gap: "6px",
                                                flexWrap: "wrap",
                                                alignItems: "center",
                                            }}
                                        >
                                            {brand.tags &&
                                            Array.isArray(brand.tags) &&
                                            brand.tags.length > 0 ? (
                                                <>
                                                    {brand.tags.map(
                                                        (
                                                            tag: string,
                                                            idx: number
                                                        ) => {
                                                            const tagColors =
                                                                getTagColor(tag)
                                                            return (
                                                                <span
                                                                    key={idx}
                                                                    style={{
                                                                        fontSize:
                                                                            "11px",
                                                                        padding:
                                                                            "2px 8px",
                                                                        borderRadius:
                                                                            "10px",
                                                                        backgroundColor:
                                                                            tagColors.bg,
                                                                        color: tagColors.color,
                                                                        fontWeight:
                                                                            "500",
                                                                        whiteSpace:
                                                                            "nowrap",
                                                                    }}
                                                                >
                                                                    {tag}
                                                                </span>
                                                            )
                                                        }
                                                    )}
                                                    {brand.score && (
                                                        <span
                                                            style={{
                                                                fontSize:
                                                                    "10px",
                                                                color: "#999",
                                                                marginLeft:
                                                                    "auto",
                                                            }}
                                                        >
                                                            {brand.score}%
                                                        </span>
                                                    )}
                                                </>
                                            ) : brand.tag ? (
                                                <span
                                                    style={{
                                                        fontSize: "11px",
                                                        padding: "2px 8px",
                                                        borderRadius: "10px",
                                                        backgroundColor:
                                                            getTagColor(
                                                                brand.tag
                                                            ).bg,
                                                        color: getTagColor(
                                                            brand.tag
                                                        ).color,
                                                        fontWeight: "500",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {brand.tag}
                                                </span>
                                            ) : null}
                                            {brand.budget && (
                                                <span
                                                    style={{
                                                        fontSize: "11px",
                                                        color: "#666",
                                                        whiteSpace: "nowrap",
                                                        marginLeft: "4px",
                                                    }}
                                                >
                                                    💰 {brand.budget}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <input
                                        type="checkbox"
                                        checked={selectedBrands.has(
                                            brand.id || brand.name
                                        )}
                                        readOnly
                                        style={{
                                            width: "20px",
                                            height: "20px",
                                            borderRadius: "50%",
                                            cursor: "pointer",
                                            flexShrink: 0,
                                        }}
                                    />
                                </label>

                                {isExpanded && brand.pitchData && (
                                    <div
                                        style={{
                                            padding: "0 20px 14px 52px",
                                            animation: "expandIn 0.3s ease-out",
                                        }}
                                    >
                                        {brand.pitchData.contacts?.length >
                                            0 && (
                                            <div
                                                style={{ marginBottom: "8px" }}
                                            >
                                                <strong
                                                    style={{
                                                        fontSize: "12px",
                                                        color: "#666",
                                                    }}
                                                >
                                                    Contacts:
                                                </strong>
                                                <div
                                                    style={{
                                                        fontSize: "12px",
                                                        color: "#555",
                                                        marginTop: "2px",
                                                    }}
                                                >
                                                    {brand.pitchData.contacts.map(
                                                        (
                                                            contact: string,
                                                            i: number
                                                        ) => (
                                                            <div key={i}>
                                                                • {contact}
                                                            </div>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {brand.pitchData.keyTopics?.length >
                                            0 && (
                                            <div
                                                style={{ marginBottom: "8px" }}
                                            >
                                                <strong
                                                    style={{
                                                        fontSize: "12px",
                                                        color: "#666",
                                                    }}
                                                >
                                                    Key Topics:
                                                </strong>
                                                <div
                                                    style={{
                                                        fontSize: "12px",
                                                        color: "#555",
                                                        marginTop: "2px",
                                                    }}
                                                >
                                                    {brand.pitchData.keyTopics.join(
                                                        ", "
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {brand.pitchData.integrationIdeas
                                            ?.length > 0 && (
                                            <div>
                                                <strong
                                                    style={{
                                                        fontSize: "12px",
                                                        color: "#666",
                                                    }}
                                                >
                                                    Integration Ideas:
                                                </strong>
                                                <div
                                                    style={{
                                                        fontSize: "12px",
                                                        color: "#555",
                                                        marginTop: "2px",
                                                    }}
                                                >
                                                    {brand.pitchData.integrationIdeas.map(
                                                        (
                                                            idea: string,
                                                            i: number
                                                        ) => (
                                                            <div key={i}>
                                                                • {idea}
                                                            </div>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>

                <div
                    style={{
                        display: "flex",
                        gap: "10px",
                        padding: "16px 20px",
                        borderTop: "1px solid rgba(255, 255, 255, 0.3)",
                        backgroundColor: "rgba(255, 255, 255, 0.5)",
                    }}
                >
                    <button
                        onClick={onClose}
                        style={{
                            flex: 1,
                            padding: "10px",
                            border: "1px solid #ddd",
                            borderRadius: "10px",
                            backgroundColor: "#fff",
                            cursor: "pointer",
                            fontSize: "15px",
                            fontWeight: "500",
                            color: "#666",
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onSend}
                        disabled={selectedBrands.size === 0}
                        style={{
                            flex: 1,
                            padding: "10px",
                            border: "none",
                            borderRadius: "10px",
                            backgroundColor:
                                selectedBrands.size > 0
                                    ? "rgba(160, 116, 26, 0.9)"
                                    : "#ccc",
                            color: "#fff",
                            cursor:
                                selectedBrands.size > 0
                                    ? "pointer"
                                    : "not-allowed",
                            fontSize: "15px",
                            fontWeight: "600",
                        }}
                    >
                        Generate ({selectedBrands.size})
                    </button>
                </div>
            </div>
        </>
    )
}

const SuggestionButton = ({ label, tooltip, onClick }) => {
    const [showTooltip, setShowTooltip] = React.useState(false)
    const isMoreBrands = label === "More brands"

    return (
        <div style={{ position: "relative" }}>
            <button
                onClick={onClick}
                style={{
                    ...styles.suggestionButton,
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                        "rgba(255, 255, 255, 0.95)"
                    e.currentTarget.style.transform = "translateY(-1px)"
                    e.currentTarget.style.boxShadow =
                        "0 4px 12px rgba(0, 0, 0, 0.12)"
                    setShowTooltip(true)
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor =
                        "rgba(255, 255, 255, 0.8)"
                    e.currentTarget.style.transform = "translateY(0)"
                    e.currentTarget.style.boxShadow =
                        "0 2px 8px rgba(0, 0, 0, 0.08)"
                    setShowTooltip(false)
                }}
            >
                {isMoreBrands && "📋 "}
                {label}
            </button>
            <div
                style={{
                    ...styles.tooltip,
                    opacity: showTooltip ? "1" : "0",
                    visibility: showTooltip ? "visible" : "hidden",
                }}
            >
                {tooltip}
            </div>
        </div>
    )
}

const extractProjectDetails = (messages: Message[]): ProjectDetails => {
    let details: ProjectDetails = {
        projectName: "",
        cast: "",
        location: "",
        vibe: "",
    }

    const reversedMessages = [...messages].reverse()

    for (const msg of reversedMessages) {
        const content = msg.content.toLowerCase()
        const originalContent = msg.content

        // Extract project name from various patterns
        if (!details.projectName) {
            // Look for explicit project/title mentions
            const projectPatterns = [
                /(?:project|title|film|show|series|movie)(?:\s+(?:is|called|titled|name))?\s*[:\-]?\s*"([^"]+)"/i,
                /(?:working on|producing|developing)\s+"([^"]+)"/i,
                /"([^"]+)".*?(?:starring|cast|synopsis)/i,
                /Brand integration suggestions for ([^:]+):/i,
                /suggestions for ([^:]+):/i,
                /^"([^"]+)"/i, // Quoted title at start
            ]

            for (const pattern of projectPatterns) {
                const match = originalContent.match(pattern)
                if (match && match[1]) {
                    details.projectName = match[1].trim()
                    break
                }
            }
        }

        if (!details.cast) {
            const castMatch = originalContent.match(
                /starring[:\s]+([^\n]+)|cast[:\s]+([^\n]+)|talent[:\s]+([^\n]+)|actors?[:\s]+([^\n]+)/i
            )
            if (castMatch) {
                let extracted = (
                    castMatch[1] ||
                    castMatch[2] ||
                    castMatch[3] ||
                    castMatch[4] ||
                    ""
                ).trim()

                const stopPatterns = [
                    /synopsis:/i,
                    /plot:/i,
                    /story:/i,
                    /location:/i,
                    /genre:/i,
                    /\./,
                    /\n/,
                ]

                for (const pattern of stopPatterns) {
                    const match = extracted.match(pattern)
                    if (match && match.index !== undefined) {
                        extracted = extracted.substring(0, match.index).trim()
                    }
                }

                if (
                    extracted &&
                    extracted.length > 3 &&
                    /[A-Z]/.test(extracted)
                ) {
                    details.cast = extracted
                }
            }
        }

        if (!details.location) {
            const locationMatch = originalContent.match(
                /location[:\s]+([^,.\n]+)|set in\s+([^,.\n]+)|filmed in\s+([^,.\n]+)|takes place in\s+([^,.\n]+)/i
            )
            if (locationMatch) {
                const extracted = (
                    locationMatch[1] ||
                    locationMatch[2] ||
                    locationMatch[3] ||
                    locationMatch[4] ||
                    ""
                ).trim()
                if (
                    extracted &&
                    extracted.length > 2 &&
                    !extracted.toLowerCase().includes("the")
                ) {
                    details.location = extracted
                }
            }
        }

        if (!details.vibe) {
            const synopsisMatch = originalContent.match(
                /synopsis[:\s]+([^.]+\.[^.]*)|plot[:\s]+([^.]+\.[^.]*)|story[:\s]+([^.]+\.[^.]*)/i
            )
            if (synopsisMatch) {
                const synopsis = (
                    synopsisMatch[1] ||
                    synopsisMatch[2] ||
                    synopsisMatch[3] ||
                    ""
                ).trim()
                if (synopsis) {
                    details.vibe = `SYNOPSIS:${synopsis}`
                }
            }

            if (!details.vibe) {
                const vibeMatch = originalContent.match(
                    /genre[:\s]+([^,.\n]+)|vibe[:\s]+([^,.\n]+)|mood[:\s]+([^,.\n]+)/i
                )
                if (vibeMatch) {
                    const extracted = (
                        vibeMatch[1] ||
                        vibeMatch[2] ||
                        vibeMatch[3] ||
                        ""
                    ).trim()
                    if (extracted && extracted.length > 2) {
                        details.vibe = extracted
                    }
                }
            }
        }

        if (details.cast && details.location && details.vibe) {
            break
        }
    }

    return details
}

const renderFormattedMessage = (
    content: string,
    projectId: string,
    sessionId: string,
    projectDetails: ProjectDetails,
    message?: Message
) => {
    const lowerContent = content.toLowerCase()
    const cleanProjectDetails = {
        ...projectDetails,
        vibe: projectDetails.vibe.startsWith("SYNOPSIS:")
            ? ""
            : projectDetails.vibe,
    }

    // --- Check for activity metadata first (structured data from backend) ---
    if (
        message?.activityMeta &&
        (message.activityMeta.meetings || message.activityMeta.emails)
    ) {
        const {
            meetings = [],
            emails = [],
            keyContacts = [],
        } = message.activityMeta
        const hasData = meetings.length > 0 || emails.length > 0

        if (hasData) {
            // Combine and sort all activities by date
            const allActivities = [
                ...meetings.map((m) => ({ ...m, type: "meeting" as const })),
                ...emails.map((e) => ({ ...e, type: "email" as const })),
            ].sort((a, b) => {
                if (!a.date && !b.date) return 0
                if (!a.date) return 1
                if (!b.date) return -1
                return new Date(b.date).getTime() - new Date(a.date).getTime()
            })

            return (
                <div
                    style={{
                        backgroundColor: "white",
                        borderRadius: "12px",
                        padding: "12px 16px",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                        border: "1px solid rgba(0, 0, 0, 0.05)",
                        position: "relative",
                        overflow: "hidden",
                        fontFamily: "'Manrope', sans-serif",
                    }}
                >
                    {/* Header */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "8px",
                        }}
                    >
                        <div
                            style={{
                                width: "3px",
                                height: "16px",
                                backgroundColor: "#6366f1",
                                borderRadius: "2px",
                            }}
                        />
                        <h2
                            style={{
                                fontSize: "14px",
                                fontWeight: "600",
                                lineHeight: "1.4",
                                color: "#222",
                                margin: "0",
                                fontFamily: "'Manrope', sans-serif",
                                flex: "1",
                            }}
                        >
                            {meetings.length > 0 && emails.length > 0
                                ? "Emails & Meetings"
                                : emails.length > 0
                                  ? "Email Communications"
                                  : "Meeting Records"}
                        </h2>
                    </div>

                    {/* Timeline items from structured data */}
                    {allActivities.map((activity, index) => {
                        const isMeeting = activity.type === "meeting"
                        const icon = isMeeting ? "🎙️" : "📧"
                        const title = isMeeting
                            ? (activity as (typeof meetings)[0]).title
                            : (activity as (typeof emails)[0]).subject
                        const url = isMeeting
                            ? (activity as (typeof meetings)[0]).url
                            : undefined

                        return (
                            <div
                                key={index}
                                style={{
                                    display: "flex",
                                    position: "relative",
                                    paddingBottom:
                                        index === allActivities.length - 1
                                            ? "0"
                                            : "16px",
                                }}
                            >
                                {/* The Line connecting dots */}
                                {index < allActivities.length - 1 && (
                                    <div
                                        style={{
                                            position: "absolute",
                                            left: "10px",
                                            top: "20px",
                                            bottom: "0",
                                            width: "1px",
                                            backgroundColor:
                                                "rgba(0, 0, 0, 0.08)",
                                            zIndex: 0,
                                        }}
                                    ></div>
                                )}

                                {/* The Dot */}
                                <div
                                    style={{
                                        width: "20px",
                                        height: "20px",
                                        borderRadius: "50%",
                                        backgroundColor: "white",
                                        border: `1px solid ${isMeeting ? "rgba(147, 51, 234, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexShrink: 0,
                                        zIndex: 1,
                                        boxShadow:
                                            "0 1px 2px rgba(0, 0, 0, 0.05)",
                                    }}
                                >
                                    <span style={{ fontSize: "10px" }}>
                                        {icon}
                                    </span>
                                </div>

                                {/* The Event Content */}
                                <div style={{ marginLeft: "12px", flex: 1 }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "baseline",
                                        }}
                                    >
                                        {url ? (
                                            <a
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    fontWeight: 600,
                                                    fontSize: "14px",
                                                    lineHeight: "1.4",
                                                    color: "#222",
                                                    textDecoration: "none",
                                                    borderBottom:
                                                        "1px dotted rgba(147, 51, 234, 0.3)",
                                                    transition: "all 0.2s ease",
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.borderBottomStyle =
                                                        "solid"
                                                    e.currentTarget.style.color =
                                                        "#9333ea"
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.borderBottomStyle =
                                                        "dotted"
                                                    e.currentTarget.style.color =
                                                        "#222"
                                                }}
                                            >
                                                {title}
                                            </a>
                                        ) : (
                                            <div
                                                style={{
                                                    fontWeight: 600,
                                                    fontSize: "14px",
                                                    lineHeight: "1.4",
                                                    color: "#222",
                                                }}
                                            >
                                                {title}
                                            </div>
                                        )}
                                        {activity.date && (
                                            <div
                                                style={{
                                                    fontSize: "11px",
                                                    fontWeight: "500",
                                                    color: "#666",
                                                    whiteSpace: "nowrap",
                                                    marginLeft: "8px",
                                                }}
                                            >
                                                {new Date(
                                                    activity.date
                                                ).toLocaleDateString()}
                                            </div>
                                        )}
                                    </div>

                                    {/* Details */}
                                    <div
                                        style={{
                                            marginTop: "6px",
                                            fontSize: "13px",
                                            lineHeight: "1.5",
                                            color: "#333",
                                        }}
                                    >
                                        {isMeeting &&
                                            (activity as (typeof meetings)[0])
                                                .participants?.length > 0 && (
                                                <div
                                                    style={{
                                                        marginBottom: "3px",
                                                    }}
                                                >
                                                    • Participants:{" "}
                                                    {(
                                                        activity as (typeof meetings)[0]
                                                    ).participants.join(", ")}
                                                </div>
                                            )}
                                        {isMeeting &&
                                            (activity as (typeof meetings)[0])
                                                .topics?.length > 0 &&
                                            (
                                                activity as (typeof meetings)[0]
                                            ).topics.map((topic, i) => (
                                                <div
                                                    key={i}
                                                    style={{
                                                        marginBottom: "3px",
                                                    }}
                                                >
                                                    • {topic}
                                                </div>
                                            ))}
                                        {!isMeeting &&
                                            (activity as (typeof emails)[0])
                                                .from && (
                                                <div
                                                    style={{
                                                        marginBottom: "3px",
                                                        fontSize: "11px",
                                                        color: "#666",
                                                    }}
                                                >
                                                    From:{" "}
                                                    {
                                                        (
                                                            activity as (typeof emails)[0]
                                                        ).from
                                                    }
                                                </div>
                                            )}
                                        {!isMeeting &&
                                            (activity as (typeof emails)[0])
                                                .summary && (
                                                <div
                                                    style={{
                                                        marginBottom: "3px",
                                                    }}
                                                >
                                                    {
                                                        (
                                                            activity as (typeof emails)[0]
                                                        ).summary
                                                    }
                                                </div>
                                            )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}

                    {/* Key Contacts section if present */}
                    {keyContacts.length > 0 && (
                        <div
                            style={{
                                marginTop: "12px",
                                paddingTop: "8px",
                                borderTop: "1px solid rgba(0, 0, 0, 0.05)",
                            }}
                        >
                            <div
                                style={{
                                    fontSize: "11px",
                                    fontWeight: "600",
                                    color: "#666",
                                    marginBottom: "4px",
                                    letterSpacing: "0.02em",
                                }}
                            >
                                KEY CONTACTS
                            </div>
                            <div
                                style={{
                                    fontSize: "13px",
                                    lineHeight: "1.5",
                                    color: "#333",
                                }}
                            >
                                {keyContacts.map((contact, i) => (
                                    <div key={i}>• {contact}</div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )
        }
    }

    // --- Original text-based detection logic continues below ---
    // A message is considered a brand suggestion if it has the specific title
    // or if it contains both "Brand:" and either "Integration:" or "Why it works:".
    const isBrandSuggestionFormat =
        lowerContent.includes("brand integration suggestions for") ||
        (lowerContent.includes("brand:") &&
            (lowerContent.includes("integration:") ||
                lowerContent.includes("why it works:")))

    // --- 1. PRIORITIZE BRAND SUGGESTION CARD ---
    if (isBrandSuggestionFormat) {
        try {
            let projectName = "Brand Integration Suggestions"
            const projectMatch = content.match(
                /Brand integration suggestions for ([^:]+):/i
            )
            if (projectMatch && projectMatch[1]) {
                projectName = projectMatch[1].trim()
            }

            const lines = content.split("\n").filter((line) => line.trim())
            const brands: { name: string; content: string[] }[] = []
            let currentBrand: { name: string; content: string[] } | null = null

            lines.forEach((line) => {
                const trimmedLine = line.trim()
                const brandMatch = trimmedLine.match(
                    /^\*?\*?Brand:\s*(.+?)\*?\*?$/i
                )

                if (brandMatch) {
                    if (currentBrand) {
                        brands.push(currentBrand)
                    }
                    currentBrand = {
                        name: brandMatch[1].trim(),
                        content: [],
                    }
                } else if (currentBrand && trimmedLine) {
                    currentBrand.content.push(trimmedLine)
                }
            })

            if (currentBrand) {
                brands.push(currentBrand)
            }

            if (brands.length > 0) {
                return (
                    <div
                        style={{
                            backgroundColor: "rgba(250, 245, 235, 0.9)",
                            borderRadius: "18px",
                            padding: "14px 18px",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
                            border: "1px solid rgba(160, 116, 26, 0.22)",
                            position: "relative",
                            overflow: "hidden",
                            fontFamily: "'Manrope', sans-serif",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                marginBottom: "4px",
                                paddingBottom: "12px",
                                borderBottom: "none",
                            }}
                        >
                            <div
                                style={{
                                    width: "4px",
                                    height: "20px",
                                    backgroundColor: "#A0741A",
                                    borderRadius: "2px",
                                }}
                            />
                            <h2
                                style={{
                                    fontSize: "18px",
                                    fontWeight: "700",
                                    color: "#222",
                                    margin: "0",
                                    fontFamily: "'Manrope', sans-serif",
                                    flex: "1",
                                }}
                            >
                                {projectName}
                            </h2>
                            <button
                                onClick={() => {
                                    // Dispatch event with brand data and project details
                                    window.dispatchEvent(
                                        new CustomEvent("brand-push-click", {
                                            detail: {
                                                brands,
                                                projectName,
                                                projectDetails: cleanProjectDetails,
                                                projectId,
                                                sessionId
                                            }
                                        })
                                    )
                                }}
                                style={{
                                    backgroundColor: "rgba(248, 249, 250, 0.9)",
                                    border: "1px solid #e9ecef",
                                    borderRadius: "6px",
                                    padding: "6px 12px",
                                    fontSize: "13px",
                                    color: "#6c757d",
                                    cursor: "pointer",
                                    transition: "all 0.15s ease",
                                    fontFamily: "'Manrope', sans-serif",
                                }}
                            >
                                <span style={{ fontSize: "16px" }}>Push</span>{" "}
                                ➡️
                            </button>
                        </div>

                        <BrandsSection
                            ref={(ref) => {
                                // Store ref to BrandsSection for accessing brand snapshots
                                if (ref && window.brandsSectionRefs) {
                                    window.brandsSectionRefs.set(projectName, ref)
                                }
                            }}
                            brands={brands}
                            title="✨ Brands & Integration Ideas"
                            projectId={projectId}
                            sessionId={sessionId}
                            projectName={projectName}
                            cast={cleanProjectDetails.cast}
                            location={cleanProjectDetails.location}
                            vibe={cleanProjectDetails.vibe}
                        />
                    </div>
                )
            }
        } catch (error) {
            console.error("Error parsing brand content:", error)
            // Fallback to default rendering if parsing fails
        }
    }

    // --- 2. CHECK FOR MEETING/EMAIL/COMMUNICATION RESULTS ---
    // Keep the SAME detection logic - don't change what's working
    const hasMeetingEmailContent =
        // Key indicators of search results about communications
        (lowerContent.includes("based on") &&
            (lowerContent.includes("meeting") ||
                lowerContent.includes("email"))) ||
        // Common phrases in communication summaries
        lowerContent.includes("key participants") ||
        lowerContent.includes("key contacts") ||
        lowerContent.includes("action items") ||
        lowerContent.includes("discussed about") ||
        lowerContent.includes("major concerns") ||
        // Result indicators
        ((lowerContent.includes("found") ||
            lowerContent.includes("summarize")) &&
            (lowerContent.includes("meeting") ||
                lowerContent.includes("email"))) ||
        // No results indicators
        lowerContent.includes("no emails") ||
        lowerContent.includes("no meetings") ||
        lowerContent.includes("weren't found") ||
        lowerContent.includes("were found") ||
        // Numbered list with meeting/email context
        (content.match(/^\d+\.\s+/m) && // Starts with "1. " or similar
            (lowerContent.includes("meeting") ||
                lowerContent.includes("email")) &&
            (lowerContent.includes("participants") ||
                lowerContent.includes("contacts") ||
                lowerContent.includes("date") ||
                lowerContent.includes("discussed")))

    if (hasMeetingEmailContent) {
        // Check if there's a summary paragraph at the beginning (before numbered items)
        const firstNumberedItem = content.search(/^\d+\./m)
        let summaryText = ""
        let itemsContent = content

        if (firstNumberedItem > 0) {
            // There's content before the first numbered item - that's our summary
            summaryText = content.substring(0, firstNumberedItem).trim()
            itemsContent = content.substring(firstNumberedItem)
        }

        // Parse numbered items
        const items = itemsContent
            .split(/(?=^\d+\.)/m)
            .filter((item) => item.trim() && item.match(/^\d+\./))

        // Beautiful timeline rendering with summary at top
        return (
            <div
                style={{
                    backgroundColor: "white",
                    borderRadius: "12px",
                    padding: "12px 16px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                    border: "1px solid rgba(0, 0, 0, 0.05)",
                    position: "relative",
                    overflow: "hidden",
                    fontFamily: "'Manrope', sans-serif",
                }}
            >
                {/* Header - Same style as brand card but with dark text */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "8px",
                    }}
                >
                    <div
                        style={{
                            width: "3px",
                            height: "16px",
                            backgroundColor: "#6366f1",
                            borderRadius: "2px",
                        }}
                    />
                    <h2
                        style={{
                            fontSize: "14px",
                            fontWeight: "600",
                            lineHeight: "1.4",
                            color: "#222",
                            margin: "0",
                            fontFamily: "'Manrope', sans-serif",
                            flex: "1",
                        }}
                    >
                        Correspondence
                    </h2>
                </div>

                {/* Summary at the top if it exists */}
                {summaryText && (
                    <div
                        style={{
                            fontSize: "13px",
                            lineHeight: "1.5",
                            color: "#333",
                            marginBottom: "12px",
                            paddingBottom: "8px",
                            borderBottom: "1px solid rgba(0, 0, 0, 0.05)",
                        }}
                    >
                        {summaryText}
                    </div>
                )}

                {/* Timeline items */}
                {items.map((item, index) => {
                    const lines = item.split("\n").filter((line) => line.trim())
                    const titleLine =
                        lines[0]?.replace(/^\d+\.\s*/, "").trim() || ""

                    // RELIABLE PARSING: Check for [MEETING] with URL or [EMAIL] without
                    const meetingMatch = titleLine.match(
                        /\[MEETING(?:\s+url="([^"]+)")?\]/
                    )
                    const isEmail = titleLine.includes("[EMAIL]")
                    const isMeeting = !!meetingMatch

                    // Extract URL only for meetings
                    const meetingUrl = meetingMatch?.[1] || null

                    // Remove the markers from the title for display
                    const cleanTitle = titleLine
                        .replace(/\[MEETING(?:\s+url="[^"]+")?\]/, "")
                        .replace("[EMAIL]", "")
                        .replace(/['"]/g, "")
                        .trim()

                    // Extract date if present (usually at the end after a dash)
                    const dateMatch = cleanTitle.match(
                        /\-\s*(\d{1,2}\/\d{1,2}\/\d{4}|\w+\s+\d{1,2},?\s+\d{4})/
                    )
                    const date = dateMatch ? dateMatch[1] : ""
                    const title = cleanTitle
                        .replace(
                            /\-\s*\d{1,2}\/\d{1,2}\/\d{4}|\-\s*\w+\s+\d{1,2},?\s+\d{4}/,
                            ""
                        )
                        .trim()

                    // Set icon based on marker (reliable!)
                    const icon = isMeeting ? "🎙️" : isEmail ? "📧" : "📄"

                    // Get the bullet points or details (everything after the title line)
                    // EXCLUDE "Key Contacts:" lines to prevent duplication
                    const details = lines
                        .slice(1)
                        .filter(
                            (line) =>
                                line.trim().length > 0 &&
                                !line.toLowerCase().includes("key contacts")
                        )

                    return (
                        <div
                            key={index}
                            style={{
                                display: "flex",
                                position: "relative",
                                paddingBottom:
                                    index === items.length - 1 ? "0" : "16px",
                            }}
                        >
                            {/* The Line connecting dots */}
                            {index < items.length - 1 && (
                                <div
                                    style={{
                                        position: "absolute",
                                        left: "10px",
                                        top: "20px",
                                        bottom: "0",
                                        width: "1px",
                                        backgroundColor: "rgba(0, 0, 0, 0.08)",
                                        zIndex: 0,
                                    }}
                                ></div>
                            )}

                            {/* The Dot */}
                            <div
                                style={{
                                    width: "20px",
                                    height: "20px",
                                    borderRadius: "50%",
                                    backgroundColor: "white",
                                    border: `1px solid ${isMeeting ? "rgba(147, 51, 234, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                    zIndex: 1,
                                    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                                }}
                            >
                                <span style={{ fontSize: "10px" }}>{icon}</span>
                            </div>

                            {/* The Event Content */}
                            <div style={{ marginLeft: "12px", flex: 1 }}>
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "baseline",
                                    }}
                                >
                                    {meetingUrl ? (
                                        <a
                                            href={meetingUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                fontWeight: 600,
                                                fontSize: "14px",
                                                lineHeight: "1.4",
                                                color: "#222",
                                                textDecoration: "none",
                                                borderBottom:
                                                    "1px dotted rgba(147, 51, 234, 0.3)",
                                                transition: "all 0.2s ease",
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.borderBottomStyle =
                                                    "solid"
                                                e.currentTarget.style.color =
                                                    "#9333ea"
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderBottomStyle =
                                                    "dotted"
                                                e.currentTarget.style.color =
                                                    "#222"
                                            }}
                                        >
                                            {title}
                                        </a>
                                    ) : (
                                        <div
                                            style={{
                                                fontWeight: 600,
                                                fontSize: "14px",
                                                lineHeight: "1.4",
                                                color: "#222",
                                            }}
                                        >
                                            {title}
                                        </div>
                                    )}
                                    {date && (
                                        <div
                                            style={{
                                                fontSize: "11px",
                                                fontWeight: "500",
                                                color: "#666",
                                                whiteSpace: "nowrap",
                                                marginLeft: "8px",
                                            }}
                                        >
                                            {date}
                                        </div>
                                    )}
                                </div>

                                {/* Details as clean list */}
                                {details.length > 0 && (
                                    <div
                                        style={{
                                            marginTop: "6px",
                                            fontSize: "13px",
                                            lineHeight: "1.5",
                                            color: "#333",
                                        }}
                                    >
                                        {details
                                            .map((detail, i) => {
                                                const cleanDetail =
                                                    detail.trim()
                                                // Skip any remaining key contact lines
                                                if (
                                                    cleanDetail
                                                        .toLowerCase()
                                                        .includes(
                                                            "rob baird"
                                                        ) ||
                                                    cleanDetail
                                                        .toLowerCase()
                                                        .includes(
                                                            "troy figgins"
                                                        ) ||
                                                    cleanDetail
                                                        .toLowerCase()
                                                        .includes("jenna perry")
                                                ) {
                                                    return null
                                                }

                                                const isBullet =
                                                    cleanDetail.startsWith(
                                                        "•"
                                                    ) ||
                                                    cleanDetail.startsWith(
                                                        "*"
                                                    ) ||
                                                    cleanDetail.startsWith("-")

                                                return (
                                                    <div
                                                        key={i}
                                                        style={{
                                                            marginBottom: "2px",
                                                            paddingLeft:
                                                                isBullet
                                                                    ? "0"
                                                                    : "12px",
                                                        }}
                                                    >
                                                        {isBullet
                                                            ? cleanDetail.replace(
                                                                  /^[•*-]\s*/,
                                                                  "• "
                                                              )
                                                            : `• ${cleanDetail}`}
                                                    </div>
                                                )
                                            })
                                            .filter(Boolean)}
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}

                {/* Key Contacts section if present */}
                {lowerContent.includes("key contacts") && (
                    <div
                        style={{
                            marginTop: "12px",
                            paddingTop: "8px",
                            borderTop: "1px solid rgba(0, 0, 0, 0.05)",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "#666",
                                marginBottom: "4px",
                                letterSpacing: "0.02em",
                            }}
                        >
                            KEY CONTACTS
                        </div>
                        <div
                            style={{
                                fontSize: "13px",
                                lineHeight: "1.5",
                                color: "#333",
                            }}
                        >
                            {content
                                .split(/key contacts[:\s]*/i)[1]
                                ?.split("\n")
                                .filter((line) => line.trim())
                                .slice(0, 10)
                                .map((contact, i) => (
                                    <div key={i}>
                                        {contact
                                            .trim()
                                            .replace(/^[*•-]\s*/, "• ")}
                                    </div>
                                ))}
                        </div>
                    </div>
                )}
            </div>
        )
    }

    // --- 3. DEFAULT RENDERER WITH IMPROVED FORMATTING ---
    return (
        <div
            style={{
                padding: "14px 18px",
                backgroundColor: "rgba(250, 245, 235, 0.85)",
                borderRadius: "14px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                border: "1px solid rgba(160, 116, 26, 0.15)",
            }}
        >
            <div
                style={{
                    fontSize: "15px",
                    lineHeight: "1.5",
                    color: "#333",
                    fontFamily: "'Manrope', sans-serif",
                }}
            >
                {content}
            </div>
        </div>
    )
}
const ChatMessage = React.memo(
    ({
        message,
        projectId,
        sessionId,
        projectDetails,
    }: {
        message: Message
        projectId: string
        sessionId: string
        projectDetails: ProjectDetails
    }) => {
        const isUser = message.sender === "user"

        return (
            <div
                style={{
                    marginBottom: "12px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    animation: isUser
                        ? "slideInFromBottom 0.4s ease-out"
                        : "slideInFromLeft 0.4s ease-out",
                    paddingLeft: "0px",
                    paddingRight: "0px",
                }}
            >
                {!isUser && message.mcpSteps && message.mcpSteps.length > 0 && (
                    <MCPDisplay
                        mcpSteps={message.mcpSteps}
                        isProcessing={false}
                        showByDefault={false}
                        style={{ marginBottom: "8px" }}
                    />
                )}

                <div
                    className="message-content"
                    style={{
                        display: "inline-block",
                        maxWidth: "100%",
                        width: "auto",
                        minWidth: "min-content",
                        padding: isUser ? "10px 14px" : "0",
                        backgroundColor: isUser
                            ? "rgba(160, 116, 26, 0.5)"
                            : "transparent",
                        opacity: 0.9,
                        color: isUser ? "#fff" : "#000",
                        borderRadius: isUser ? 15 : 0,
                        boxShadow: isUser
                            ? "0px 1px 2px rgba(0, 0, 0, 0.15)"
                            : "none",
                        whiteSpace: "pre-wrap",
                        wordWrap: "break-word",
                    }}
                >
                    {isUser ? (
                        <ReactMarkdown
                            allowedElements={[
                                "strong",
                                "em",
                                "code",
                                "p",
                                "br",
                                "ul",
                                "ol",
                                "li",
                            ]}
                            unwrapDisallowed
                            components={{
                                p: ({ children }) => <>{children}</>,
                                strong: ({ children }) => (
                                    <strong>{children}</strong>
                                ),
                                em: ({ children }) => <em>{children}</em>,
                                code: ({ children }) => (
                                    <code
                                        style={{
                                            backgroundColor:
                                                "rgba(255,255,255,0.2)",
                                            padding: "2px 4px",
                                            borderRadius: "3px",
                                        }}
                                    >
                                        {children}
                                    </code>
                                ),
                            }}
                        >
                            {message.content}
                        </ReactMarkdown>
                    ) : (
                        renderFormattedMessage(
                            message.content,
                            projectId,
                            sessionId,
                            projectDetails,
                            message
                        )
                    )}
                    {message.status === "error" && (
                        <div
                            style={{
                                fontSize: "12px",
                                marginTop: "4px",
                                opacity: 0.7,
                            }}
                        >
                            Failed to send - tap to retry
                        </div>
                    )}
                </div>
                {message.timestamp && (
                    <div
                        style={{
                            fontSize: "11px",
                            color: "#999",
                            marginTop: "4px",
                        }}
                    >
                        {new Date(message.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                        })}
                    </div>
                )}
            </div>
        )
    }
)

ChatMessage.displayName = "ChatMessage"

export default function ChatDisplay({
    projectId = "HB-PitchAssist",
}: {
    projectId?: string
}) {
    const [messages, setMessages] = React.useState<Message[]>([])
    const [isLoading, setIsLoading] = React.useState(false)
    const [isTyping, setIsTyping] = React.useState(false)
    const [sessionId] = React.useState(
        `${Date.now()}-${Math.floor(Math.random() * 10000)}`
    )
    const [showSuggestions, setShowSuggestions] = React.useState(false)
    const [mcpSteps, setMcpSteps] = React.useState<
        { text: string; timestamp: number; type?: string }[]
    >([])
    const mcpStepsRef = React.useRef(mcpSteps)
    React.useEffect(() => {
        mcpStepsRef.current = mcpSteps
    }, [mcpSteps])

    const [mcpProcessing, setMcpProcessing] = React.useState(false)
    const [routeStatus, setRouteStatus] = React.useState<string | null>(null)
    const [brandSuggestions, setBrandSuggestions] = React.useState<any[]>([])
    const [isPitchRequest, setIsPitchRequest] = React.useState(false)
    const [currentProjectName, setCurrentProjectName] = React.useState("")
    const [showBrandPicker, setShowBrandPicker] =
        React.useState<HTMLElement | null>(null)
    const [selectedBrands, setSelectedBrands] = React.useState(
        new Set<string>()
    )
    const [pushing, setPushing] = React.useState(false)
    const [showPushPopup, setShowPushPopup] = React.useState<any>(null)

    const [projectDetails, setProjectDetails] = React.useState<ProjectDetails>({
        projectName: "",
        cast: "",
        location: "",
        vibe: "",
    })
    const chatContainerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (typeof window !== "undefined") {
            const link = document.createElement("link")
            link.href =
                "https://fonts.googleapis.com/css2?family=Manrope:wght@400;700&display=swap"
            link.rel = "stylesheet"
            document.head.appendChild(link)
            
            // Initialize refs map for BrandsSection instances
            if (!window.brandsSectionRefs) {
                window.brandsSectionRefs = new Map()
            }
        }
    }, [])

    React.useEffect(() => {
        if (chatContainerRef.current) {
            // The 50ms delay is essential for waiting for the DOM to update.
            setTimeout(() => {
                chatContainerRef.current?.scrollTo({
                    top: chatContainerRef.current.scrollHeight,
                    behavior: "smooth",
                })
            }, 50)
        }
    }, [messages, isTyping, mcpSteps.length, showBrandPicker]) // Scroll on new messages, typing state change, MCP steps count change, or picker state change

    React.useEffect(() => {
        const recentMessages = messages.slice(-10)
        const details = extractProjectDetails(recentMessages)
        setProjectDetails(details)
    }, [messages])

    React.useEffect(() => {
        if (projectDetails.vibe.startsWith("SYNOPSIS:")) {
            const synopsis = projectDetails.vibe.replace("SYNOPSIS:", "")

            fetch("https://chat-backend-vert.vercel.app/api/chatWithOpenAI", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userMessage: `Convert this synopsis into a short vibe description (max 10 words, focus on genre/mood/setting): "${synopsis}"`,
                    sessionId: sessionId + "-vibe",
                    projectId: projectId,
                }),
            })
                .then((response) => response.json())
                .then((data) => {
                    if (data.reply) {
                        setProjectDetails((prev) => ({
                            ...prev,
                            vibe: data.reply.trim().replace(/['"]/g, ""),
                        }))
                    }
                })
                .catch((error) => {
                    setProjectDetails((prev) => ({
                        ...prev,
                        vibe: "",
                    }))
                })
        }
    }, [projectDetails.vibe, sessionId, projectId])

    const addMessage = React.useCallback(
        (
            sender: "user" | "assistant",
            content: string,
            status?: Message["status"],
            mcpSteps?: { text: string; timestamp: number; type?: string }[],
            activityMeta?: Message["activityMeta"]
        ) => {
            const newMessage: Message = {
                id: `${Date.now()}-${Math.random().toString(36)}`,
                sender,
                content,
                timestamp: new Date(),
                status: status || "sent",
                mcpSteps: mcpSteps || undefined,
                activityMeta: activityMeta || undefined,
            }
            setMessages((prev) => [...prev, newMessage])
            return newMessage.id
        },
        []
    )

    const updateMessageStatus = React.useCallback(
        (messageId: string, status: Message["status"]) => {
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === messageId ? { ...msg, status } : msg
                )
            )
        },
        []
    )

    const startMcpPolling = React.useCallback(() => {
        let stop = false
        let pollCount = 0
        const tick = async () => {
            try {
                const r = await fetch(
                    `https://chat-backend-vert.vercel.app/api/chatWithOpenAI?progress=true&sessionId=${sessionId}`
                )
                const j = await r.json()
                pollCount++
                console.log(`Poll #${pollCount} response:`, j) // Debug log with count

                // Only update if we have fresh steps
                if (j.steps && Array.isArray(j.steps)) {
                    setMcpSteps(j.steps)
                    mcpStepsRef.current = j.steps
                }

                setMcpProcessing(!j.done)
                if (!stop && !j.done) setTimeout(tick, 800)
            } catch (err) {
                console.error("Polling error:", err) // Debug log
            }
        }
        tick()
        return () => {
            stop = true
        }
    }, [sessionId])

    const sendMessageToAssistant = React.useCallback(
        async (
            messageContent: string,
            retryCount = 0,
            existingMessageId?: string,
            additionalContext?: { productionContext?: string }
        ) => {
            if (!messageContent.trim() || isLoading) return

            const truncatedMessage =
                messageContent.length > 5000
                    ? messageContent.slice(0, 5000) + "..."
                    : messageContent
            const messageId =
                existingMessageId ||
                addMessage("user", truncatedMessage, "sending")

            const isSearchQuery =
                messageContent.toLowerCase().includes("brand") ||
                messageContent.toLowerCase().includes("match") ||
                messageContent.toLowerCase().includes("meeting") ||
                messageContent.toLowerCase().includes("email") ||
                messageContent.toLowerCase().includes("synopsis")

            if (
                messages.filter((m) => m.sender === "user").length === 0 &&
                !showSuggestions
            ) {
                setShowSuggestions(true)
            }

            setIsLoading(true)
            setIsTyping(true)

            // Clear ALL MCP-related state completely before starting
            setMcpSteps([])
            mcpStepsRef.current = []
            setMcpProcessing(false)

            // Small delay to ensure React has cleared the state
            await new Promise((resolve) => setTimeout(resolve, 50))

            // Frontend route detection
            const lowerMessage = messageContent.toLowerCase()

            const isBrandSearch =
                lowerMessage.includes("brand") ||
                lowerMessage.includes("match") ||
                lowerMessage.includes("suggest") ||
                lowerMessage.includes("integration") ||
                lowerMessage.includes("synopsis") ||
                lowerMessage.includes("easy money") ||
                lowerMessage.includes("wildcard") ||
                lowerMessage.includes("audience") ||
                lowerMessage.includes("production money")

            const isCommunicationSearch =
                lowerMessage.includes("meeting") ||
                lowerMessage.includes("email") ||
                lowerMessage.includes("fireflies") ||
                lowerMessage.includes("contact") ||
                lowerMessage.includes("reach")

            const isPitchCreation =
                lowerMessage.includes("pitch") ||
                (lowerMessage.includes("create") &&
                    lowerMessage.includes("for"))

            // Set frontend's understanding of the route
            if (isBrandSearch) {
                setRouteStatus("Searching for brand matches...")
            } else if (isCommunicationSearch) {
                setRouteStatus("Searching communications...")
            } else if (isPitchCreation) {
                setRouteStatus("Creating pitch ideas...")
            } else {
                setRouteStatus("Processing request...")
            }

            // NOW start fresh polling with clean state
            setMcpProcessing(true)
            const stopPolling = startMcpPolling()

            try {
                const response = await fetch(
                    "https://chat-backend-vert.vercel.app/api/chatWithOpenAI",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            userMessage: truncatedMessage,
                            sessionId,
                            projectId,
                            projectName: currentProjectName, // ADD THIS LINE
                        }),
                    }
                )

                if (!response.ok)
                    throw new Error(`HTTP error ${response.status}`)

                const data = await response.json()

                // Handle Brand Suggestions (store them but don't show picker automatically)
                if (
                    data.structuredData &&
                    data.structuredData.brandSuggestions
                ) {
                    setBrandSuggestions(data.structuredData.brandSuggestions)

                    // Store project name if available but don't show picker
                    if (data.structuredData.productionContext) {
                        const match =
                            data.structuredData.productionContext.match(
                                /^(.*?)(?:\nSynopsis:|$)/i
                            )
                        if (match && match[1]) {
                            setCurrentProjectName(match[1].trim())
                        }
                    }
                } else {
                    setBrandSuggestions([]) // Clear old suggestions
                }

                // Check if this is a pitch request
                if (
                    data.structuredData &&
                    data.structuredData.pitchRequest === true
                ) {
                    setIsPitchRequest(true)
                } else {
                    setIsPitchRequest(false)
                }

                // Check if backend sends project name directly
                if (data.projectName) {
                    setProjectDetails((prev) => ({
                        ...prev,
                        projectName: data.projectName,
                    }))
                }

                // Add the final AI reply to the chat
                if (data.reply) {
                    updateMessageStatus(messageId, "sent")
                    setIsTyping(false)
                    setRouteStatus(null)

                    // Capture the current MCP steps from polling using ref to avoid stale closure
                    const finalMcpSteps =
                        mcpStepsRef.current.length > 0
                            ? [...mcpStepsRef.current]
                            : undefined
                    console.log("Final MCP steps being saved:", finalMcpSteps) // Debug

                    setMcpProcessing(false)
                    if (typeof stopPolling === "function") stopPolling()

                    // Pass the live-polled mcpSteps (not cached ones from backend)
                    addMessage(
                        "assistant",
                        data.reply,
                        "sent",
                        finalMcpSteps, // Use the live-polled steps
                        data.activityMetadata || undefined
                    )

                    // Don't clear mcpSteps - let them persist with the message
                }
            } catch (error) {
                setIsTyping(false)
                setRouteStatus(null)
                setMcpSteps([])
                setMcpProcessing(false)
                if (typeof stopPolling === "function") stopPolling()

                if (
                    error.message.includes("529") ||
                    error.message.includes("overloaded")
                ) {
                    updateMessageStatus(messageId, "error")
                    addMessage(
                        "assistant",
                        "The service is temporarily overloaded. Please try again in a few moments."
                    )
                } else if (retryCount < 2) {
                    setTimeout(
                        () =>
                            sendMessageToAssistant(
                                messageContent,
                                retryCount + 1,
                                messageId,
                                additionalContext
                            ),
                        Math.pow(2, retryCount) * 1000
                    )
                } else {
                    updateMessageStatus(messageId, "error")
                    addMessage(
                        "assistant",
                        "I'm having trouble connecting right now. Please try again in a moment."
                    )
                }
            }

            setIsLoading(false)
        },
        [
            isLoading,
            addMessage,
            updateMessageStatus,
            sessionId,
            projectId,
            messages,
            showSuggestions,
            currentProjectName,
        ]
    )

    React.useEffect(() => {
        addMessage(
            "assistant",
            "Welcome back! Highlight a project & press Send. I'll suggest matches and help generate pitch ideas!"
        )
    }, [addMessage])

    React.useEffect(() => {
        window.sendMessageToAssistant = sendMessageToAssistant
    }, [sendMessageToAssistant])

    // Handler for creating email drafts
    const handleCreateEmailDrafts = React.useCallback(async (eventDetail: any) => {
        if (pushing) return
        setPushing(true)
        
        try {
            const { projectName, projectDetails: details } = eventDetail
            
            // Get the BrandsSection ref for this project
            const brandsSectionRef = window.brandsSectionRefs?.get(projectName)
            
            // Get brand snapshots from BrandsSection methods
            const brandsFromRef = brandsSectionRef?.getSelectedSnapshot?.() 
                || brandsSectionRef?.getActiveSnapshots?.() 
                || []
            
            if (!Array.isArray(brandsFromRef) || brandsFromRef.length === 0) {
                console.warn("No brand cards available in this section.")
                setPushing(false)
                return
            }

            // Get production metadata from BrandsSection
            const productionDataFromRef = brandsSectionRef?.getProductionMeta?.() || {}
            
            // Helper functions for minimal payload
            function asUrl(u: any) {
                return (typeof u === 'string' && /^https?:\/\//i.test(u) && u.length < 1000) ? u : null
            }
            
            function toMiniBrand(b: any) {
                const ideas = Array.isArray(b.integrationIdeas) 
                    ? b.integrationIdeas 
                    : (b.integrationIdeas ? [b.integrationIdeas] : [])
                
                // contentText fallback (if BrandCard exposes content as array/lines)
                const contentText = Array.isArray(b.content) 
                    ? b.content.join('\n') 
                    : String(b.content || '')
                
                return {
                    name: b.name || b.brand || '',
                    whyItWorks: String(b.whyItWorks || '').slice(0, 1400),
                    hbInsights: String(b.hbInsights || '').slice(0, 1400),
                    integrationIdeas: ideas.slice(0, 8).map((x: any) => String(x).slice(0, 200)),
                    contentText: contentText.slice(0, 2000), // helpful fallback for the model
                    posterUrl: asUrl(b.posterUrl),
                    videoUrl: asUrl(b.videoUrl || b.exportedVideo),
                    pdfUrl: asUrl(b.pdfUrl || b.brandCardPDF),
                    audioUrl: asUrl(b.audioUrl),
                    assets: (Array.isArray(b.assets) ? b.assets : [])
                        .filter((a: any) => a && asUrl(a.url))
                        .slice(0, 12)
                        .map((a: any) => ({
                            title: a.title || a.type || 'Link',
                            type: a.type || 'link',
                            url: a.url
                        }))
                }
            }
            
            const miniBrands = brandsFromRef.map(toMiniBrand)
            
            const payload = {
                pushDraft: true,
                productionData: {
                    projectName: productionDataFromRef.projectName || projectName || details?.projectName || '',
                    vibe: productionDataFromRef.vibe || details?.vibe || '',
                    cast: productionDataFromRef.cast || details?.cast || '',
                    location: productionDataFromRef.location || details?.location || '',
                    notes: String(productionDataFromRef.notes || '').slice(0, 1400)
                },
                brands: miniBrands
                // Don't send to/cc - backend defaults to shap@hollywoodbranded.com
            }
            
            const bytes = new Blob([JSON.stringify(payload)]).size
            console.log('push payload MB:', (bytes/1024/1024).toFixed(2))

            const resp = await fetch("https://chat-backend-vert.vercel.app/api/pushDraft", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            })

            if (!resp.ok) {
                let msg = `pushDraft failed: ${resp.status}`
                try {
                    const j = await resp.json()
                    msg = j?.error || msg
                } catch {}
                throw new Error(msg)
            }

            const data = await resp.json()
            if (data?.webLink) {
                window.open(data.webLink, "_blank", "noopener,noreferrer")
                setShowPushPopup(null) // close popup on success
            } else if (Array.isArray(data?.webLinks) && data.webLinks.length) {
                window.open(data.webLinks[0], "_blank", "noopener,noreferrer")
                setShowPushPopup(null)
            } else {
                console.warn("Draft created but no webLink returned.")
            }
        } catch (err) {
            console.error("Error creating email draft:", err)
        } finally {
            setPushing(false)
        }
    }, [pushing])

    // Listen for push button clicks
    React.useEffect(() => {
        const handlePushClick = (event: CustomEvent) => {
            if (event.detail) {
                setShowPushPopup(event.detail)
            }
        }

        window.addEventListener("brand-push-click", handlePushClick as EventListener)
        return () => {
            window.removeEventListener("brand-push-click", handlePushClick as EventListener)
        }
    }, [])

    const suggestionButtons = [
        {
            label: "More like these brands",
            tooltip: "Gets similar brands in the same space",
            message: "More brands like these for this project",
        },
        {
            label: "Easy money brands",
            tooltip: "Brands that always spend • Quick yes",
            message: "Easy money brands for this project",
        },
        {
            label: "Gen AI Brands",
            tooltip: "AI/ML companies building the future",
            message: "Gen AI brands for this project",
        },
        {
            label: "Wildcard brand ideas",
            tooltip: "Unexpected matches • AI, crypto, DTC",
            message: "Wildcard brand ideas for this project",
        },
        {
            label: "Better audience match",
            tooltip: "Brand customers = show viewers",
            message: "Brands with better audience match for this project",
        },
        {
            label: "Brands that save production money",
            tooltip: "Provide cars, locations, wardrobe",
            message: "Brands that save production money for this project",
        },
        {
            label: "Hot new brands",
            tooltip: "Trending with fresh budgets",
            message: "Hot new brands for this project",
        },
        {
            label: "Fits the story better",
            tooltip: "Enhances narrative, not interrupts",
            message: "Brands that fit the story better for this project",
        },
        {
            label: "Bigger partnership ideas",
            tooltip: "Full campaigns + social deals",
            message: "Bigger partnership ideas for this project",
        },
    ]

    return (
        <div
            ref={chatContainerRef}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflowY: "auto",
                padding: "0 16px 16px 16px",
                boxSizing: "border-box",
                fontFamily: "'Manrope', sans-serif",
                display: "flex",
                flexDirection: "column",
            }}
        >
            <div style={{ flexGrow: 1, paddingTop: "73px", paddingBottom: "80px" }}>
                {messages.map((message) => (
                    <ChatMessage
                        key={message.id}
                        message={message}
                        projectId={projectId}
                        sessionId={sessionId}
                        projectDetails={projectDetails}
                    />
                ))}

                {isTyping && (
                    <div
                        style={{
                            marginBottom: "12px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            animation: "slideInFromLeft 0.4s ease-out",
                            width: "100%",
                        }}
                    >
                        {mcpSteps && mcpSteps.length > 0 && (
                            <MCPDisplay
                                mcpSteps={mcpSteps}
                                isProcessing={mcpProcessing}
                                showByDefault={true}
                            />
                        )}

                        <div
                            style={{
                                display: "inline-block",
                                maxWidth: "96%",
                                backgroundColor: "transparent",
                                borderRadius: 20,
                                position: "relative",
                                isolation: "isolate",
                            }}
                        >
                            <div
                                style={{
                                    background:
                                        "linear-gradient(135deg, #9333ea 0%, #A0741A 50%, #9333ea 100%)",
                                    backgroundSize: "200% 200%",
                                    animation: "gradientShift 3s ease infinite",
                                    borderRadius: 20,
                                    padding: "10px 14px",
                                    position: "relative",
                                    overflow: "visible",
                                }}
                            >
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "-10px",
                                        left: "-10px",
                                        right: "-10px",
                                        bottom: "-10px",
                                        borderRadius: 25,
                                        background:
                                            "radial-gradient(ellipse at center, rgba(147,51,234,0.3) 0%, transparent 70%)",
                                        filter: "blur(10px)",
                                        animation:
                                            "glowPulse 2s ease-in-out infinite",
                                        pointerEvents: "none",
                                    }}
                                />

                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        position: "relative",
                                        zIndex: 1,
                                    }}
                                >
                                    {routeStatus ? (
                                        <>
                                            {["0s", "0.2s", "0.4s"].map(
                                                (delay, index) => (
                                                    <div
                                                        key={index}
                                                        style={{
                                                            width: "6px",
                                                            height: "6px",
                                                            marginRight: "3px",
                                                            backgroundColor:
                                                                "rgba(255,255,255,0.9)",
                                                            borderRadius: "50%",
                                                            animation:
                                                                "typingBlink 1s infinite",
                                                            animationDelay:
                                                                delay,
                                                            boxShadow:
                                                                "0 0 6px rgba(255,255,255,0.8)",
                                                        }}
                                                    />
                                                )
                                            )}
                                            <span
                                                style={{
                                                    color: "rgba(255,255,255,0.9)",
                                                    fontSize: "13px",
                                                    fontWeight: "500",
                                                    letterSpacing: "0.02em",
                                                    marginLeft: "6px",
                                                    textShadow:
                                                        "0 0 6px rgba(255,255,255,0.8)",
                                                }}
                                            >
                                                {routeStatus}
                                            </span>
                                        </>
                                    ) : (
                                        ["0s", "0.2s", "0.4s"].map(
                                            (delay, index) => (
                                                <div
                                                    key={index}
                                                    style={{
                                                        width: "8px",
                                                        height: "8px",
                                                        marginRight: "4px",
                                                        backgroundColor:
                                                            "rgba(255,255,255,0.9)",
                                                        borderRadius: "50%",
                                                        animation:
                                                            "typingBlink 1s infinite",
                                                        animationDelay: delay,
                                                        boxShadow:
                                                            "0 0 6px rgba(255,255,255,0.8)",
                                                    }}
                                                />
                                            )
                                        )
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {showSuggestions && !isTyping && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "12px 0 16px",
                            position: "relative",
                            zIndex: 1,
                        }}
                    >
                        <SuggestionButton
                            label="More brands"
                            tooltip="View all 15 brand suggestions"
                            onClick={(e) => {
                                const button = e.currentTarget
                                if (brandSuggestions.length > 0) {
                                    // Find the most recent project name from messages
                                    let recentProjectName =
                                        projectDetails.projectName

                                    // Look through recent messages for brand integration suggestions
                                    const recentMessages = messages
                                        .slice(-10)
                                        .reverse()
                                    for (const msg of recentMessages) {
                                        if (
                                            msg.sender === "assistant" &&
                                            msg.content.includes(
                                                "Brand integration suggestions for"
                                            )
                                        ) {
                                            const match = msg.content.match(
                                                /Brand integration suggestions for ([^:]+):/i
                                            )
                                            if (match && match[1]) {
                                                recentProjectName =
                                                    match[1].trim()
                                                break
                                            }
                                        }
                                    }

                                    setShowBrandPicker(button)
                                    setCurrentProjectName(recentProjectName)
                                } else {
                                    // Build production context from project details
                                    const contextParts = []
                                    if (projectDetails.projectName)
                                        contextParts.push(
                                            `Title: ${projectDetails.projectName}`
                                        )
                                    if (projectDetails.cast)
                                        contextParts.push(
                                            `Cast: ${projectDetails.cast}`
                                        )
                                    if (projectDetails.location)
                                        contextParts.push(
                                            `Location: ${projectDetails.location}`
                                        )
                                    if (
                                        projectDetails.vibe &&
                                        !projectDetails.vibe.startsWith(
                                            "SYNOPSIS:"
                                        )
                                    ) {
                                        contextParts.push(
                                            `Vibe: ${projectDetails.vibe}`
                                        )
                                    }

                                    sendMessageToAssistant(
                                        "Show me brand suggestions for this project",
                                        0,
                                        undefined,
                                        contextParts.length > 0
                                            ? {
                                                  productionContext:
                                                      contextParts.join("\n"),
                                              }
                                            : undefined
                                    )
                                }
                            }}
                        />

                        <div
                            style={{
                                display: "flex",
                                gap: "8px",
                                overflowX: "auto",
                                flex: 1,
                                WebkitOverflowScrolling: "touch",
                                scrollbarWidth: "none",
                                msOverflowStyle: "none",
                                opacity: 0.8,
                            }}
                        >
                            {suggestionButtons.slice(1).map((btn, i) => {
                                // Build production context for all suggestion buttons
                                const contextParts = []
                                if (projectDetails.projectName)
                                    contextParts.push(
                                        `Title: ${projectDetails.projectName}`
                                    )
                                if (projectDetails.cast)
                                    contextParts.push(
                                        `Cast: ${projectDetails.cast}`
                                    )
                                if (projectDetails.location)
                                    contextParts.push(
                                        `Location: ${projectDetails.location}`
                                    )
                                if (
                                    projectDetails.vibe &&
                                    !projectDetails.vibe.startsWith("SYNOPSIS:")
                                ) {
                                    contextParts.push(
                                        `Vibe: ${projectDetails.vibe}`
                                    )
                                }
                                const productionContext =
                                    contextParts.length > 0
                                        ? contextParts.join("\n")
                                        : undefined

                                return (
                                    <SuggestionButton
                                        key={i}
                                        label={btn.label}
                                        tooltip={btn.tooltip}
                                        onClick={
                                            btn.onClick ||
                                            (() =>
                                                sendMessageToAssistant(
                                                    btn.message || btn.label,
                                                    0,
                                                    undefined,
                                                    productionContext
                                                        ? { productionContext }
                                                        : undefined
                                                ))
                                        }
                                    />
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>

            {showBrandPicker && brandSuggestions.length > 0 && (
                <BrandPicker
                    brands={brandSuggestions}
                    selectedBrands={selectedBrands}
                    anchorElement={showBrandPicker}
                    isPitchRequest={isPitchRequest}
                    projectName={currentProjectName}
                    onToggle={(brandId) => {
                        const newSelected = new Set(selectedBrands)
                        if (newSelected.has(brandId)) {
                            newSelected.delete(brandId)
                        } else {
                            newSelected.add(brandId)
                        }
                        setSelectedBrands(newSelected)
                    }}
                    onClose={() => {
                        setShowBrandPicker(null)
                        setSelectedBrands(new Set())
                    }}
                    onSend={() => {
                        const selectedBrandNames = brandSuggestions
                            .filter((b) => selectedBrands.has(b.id || b.name))
                            .map((b) => b.name)
                            .join(", ")

                        sendMessageToAssistant(
                            `Create pitches for ${selectedBrandNames} for this production`
                        )

                        setShowBrandPicker(null)
                        setSelectedBrands(new Set())
                    }}
                />
            )}

            {/* Push Popup - iOS notification style */}
            {showPushPopup && (
                <>
                    <div
                        style={{
                            position: "fixed",
                            inset: "0",
                            backgroundColor: "rgba(0, 0, 0, 0.3)",
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                            transition: "all 0.3s ease",
                            animation: "fadeIn 0.3s ease",
                            zIndex: 10000,
                        }}
                        onClick={() => !pushing && setShowPushPopup(null)}
                    />
                    <div
                        style={{
                            position: "fixed",
                            top: "115px",
                            left: "50%",
                            transform: "translateX(-50%)",
                            backgroundColor: "#ffffff",
                            borderRadius: "14px",
                            padding: "16px",
                            boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
                            border: "1px solid rgba(0,0,0,0.1)",
                            zIndex: 10001,
                            minWidth: "320px",
                            animation: "slideInUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3
                            style={{
                                fontSize: "15px",
                                fontWeight: "600",
                                margin: "0 0 12px 0",
                                fontFamily: "'Manrope', sans-serif",
                            }}
                        >
                            Push Options
                        </h3>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "12px",
                            }}
                        >
                            <button
                                style={{
                                    padding: "12px 20px",
                                    backgroundColor: "rgba(255, 111, 97, 0.1)",
                                    border: "1px solid rgba(255, 111, 97, 0.2)",
                                    borderRadius: "8px",
                                    cursor: "pointer",
                                    transition: "all 0.15s ease",
                                    fontSize: "14px",
                                    fontWeight: "500",
                                    fontFamily: "'Manrope', sans-serif",
                                    textAlign: "left",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = "rgba(255, 111, 97, 0.2)"
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "rgba(255, 111, 97, 0.1)"
                                }}
                                onClick={() => {
                                    // Placeholder for future HubSpot integration
                                    console.log("Push to HubSpot - coming soon")
                                    setShowPushPopup(null)
                                }}
                            >
                                🔗 Push to HubSpot
                            </button>
                            <button
                                style={{
                                    padding: "12px 20px",
                                    backgroundColor: pushing 
                                        ? "rgba(11, 147, 246, 0.05)"
                                        : "rgba(11, 147, 246, 0.1)",
                                    border: "1px solid rgba(11, 147, 246, 0.2)",
                                    borderRadius: "8px",
                                    cursor: pushing ? "not-allowed" : "pointer",
                                    transition: "all 0.15s ease",
                                    fontSize: "14px",
                                    fontWeight: "500",
                                    fontFamily: "'Manrope', sans-serif",
                                    textAlign: "left",
                                    opacity: pushing ? 0.7 : 1,
                                }}
                                onMouseEnter={(e) => {
                                    if (!pushing) {
                                        e.currentTarget.style.backgroundColor = "rgba(11, 147, 246, 0.2)"
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!pushing) {
                                        e.currentTarget.style.backgroundColor = "rgba(11, 147, 246, 0.1)"
                                    }
                                }}
                                onClick={() => {
                                    if (!pushing) {
                                        handleCreateEmailDrafts(showPushPopup)
                                    }
                                }}
                                disabled={pushing}
                            >
                                {pushing ? "📝 Creating..." : "📝 Create Email Drafts"}
                            </button>
                        </div>
                    </div>
                </>
            )}

            <style>{`
            .message-content { font-size: 15px; font-family: 'Manrope', sans-serif; }
            @keyframes typingBlink { 0% { opacity: 0.2; } 20% { opacity: 1; } 100% { opacity: 0.2; } }
            @keyframes slideInFromLeft { 0% { transform: translateX(-100px); opacity: 0; } 50% { transform: translateX(-10px); } 100% { transform: translateX(0); opacity: 1; } }
            @keyframes slideInFromBottom { 0% { transform: translateY(50px); opacity: 0; } 50% { transform: translateY(5px); } 100% { transform: translateY(0); opacity: 1; } }
            @keyframes slideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes hueShift { 0% { filter: hue-rotate(0deg) brightness(1.1); } 100% { filter: hue-rotate(360deg) brightness(1.1); } }
            @keyframes gradientShift {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
            }
            @keyframes glowPulse {
                0% { opacity: 0.3; transform: scale(1); }
                50% { opacity: 0.6; transform: scale(1.1); }
                100% { opacity: 0.3; transform: scale(1); }
            }
            @keyframes fadeInScale {
                from { opacity: 0; transform: scale(0.95) translateY(-10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            @keyframes slideDown {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideInUp {
                from { 
                    opacity: 0; 
                    transform: translateX(-50%) translateY(20px) scale(0.9); 
                }
                to { 
                    opacity: 1; 
                    transform: translateX(-50%) translateY(0) scale(1); 
                }
            }
            @keyframes pulse {
                0% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.6; transform: scale(0.8); }
                100% { opacity: 1; transform: scale(1); }
            }
            @keyframes expandIn {
                from { 
                    opacity: 0; 
                    max-height: 0;
                    transform: scaleY(0);
                    transform-origin: top;
                }
                to { 
                    opacity: 1; 
                    max-height: 200px;
                    transform: scaleY(1);
                }
            }
            @keyframes fadeInLine {
                from { 
                    opacity: 0; 
                    transform: translateX(-10px);
                }
                to { 
                    opacity: 1; 
                    transform: translateX(0);
                }
            }
            .message-content ol, .message-content ul { margin: 0; padding-left: 20px; }
            .message-content li { margin-bottom: 6px; }
        `}</style>
        </div>
    )
}

declare global {
    interface Window {
        sendMessageToAssistant?: (message: string) => void
        brandsSectionRefs?: Map<string, any>
    }
}

addPropertyControls(ChatDisplay, {
    projectId: {
        type: ControlType.String,
        title: "Project ID",
        defaultValue: "HB-PitchAssist",
        description:
            "Unique identifier for this chat instance (e.g., 'client-x', 'real-estate')",
    },
})
