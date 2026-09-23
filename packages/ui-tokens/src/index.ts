export const crmTokens = {
  color: {
    canvas: "#f6f6f7",
    panel: "#ffffff",
    panelMuted: "#f1f2f4",
    text: "#202223",
    textMuted: "#6d7175",
    textSubtle: "#8c9196",
    border: "#dcdfe4",
    borderStrong: "#babfc3",
    accent: "#008060",
    accentHover: "#006e52",
    accentActive: "#005e46",
    accentSoft: "#e3f1df",
    accentSoftStrong: "#bbe5b3",
    danger: "#d82c0d",
    dangerSoft: "#fff4f4",
    warning: "#ffc453",
    warningSoft: "#fff5ea",
    success: "#008060",
    successSoft: "#e3f1df"
  },
  radius: {
    sm: "8px",
    md: "12px",
    lg: "16px"
  },
  shadow: {
    panel: "0 10px 30px rgba(32, 34, 35, 0.08)"
  },
  spacing: {
    xs: "4px",
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "32px"
  }
} as const;

export type CrmTokens = typeof crmTokens;
