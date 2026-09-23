export interface Member {
  id?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  initials: string;
  color: string;
  assignedTaskCount?: number;
  doneTaskCount?: number;
  doneTaskPercent?: number;
}

export interface Project {
  id: string;
  hierarchyOrderVersion?: number;
  accountId?: string;
  name: string;
  description: string;
  status: "Active" | "In Review" | "Planning" | "On Hold" | "Completed" | "At Risk";
  priority: "Critical" | "High" | "Medium" | "Low";
  progress: number;
  budget: number;
  spent: number;
  startDate: string;
  dueDate: string;
  members: Member[];
  ownerUserId?: string;
  ownerDisplayName?: string;
  ownerAvatarUrl?: string;
  memberUserIds?: string[];
  projectType?: string;
  scopeSummary?: string;
  budgetCurrency?: string;
  tasks: { total: number; done: number };
  plannedHours?: number;
  loggedHours?: number;
  pnlHours?: number;
  client: string;
  color: string;
  tags: string[];
  category: string;
}

export const PROJECTS: Project[] = [
  {
    id:"p1", name:"CRM Platform v2.0",       description:"Full redesign and rebuild of the core CRM platform with AI-assisted features and real-time collaboration.",
    status:"Active",    priority:"Critical", progress:72, budget:180000, spent:129600,
    startDate:"Sep 1, 2078",  dueDate:"Mar 31, 2079",
    members:[{initials:"AN",color:"#f472b6"},{initials:"BT",color:"#60a5fa"},{initials:"DP",color:"#c084fc"},{initials:"GK",color:"#facc15"}],
    tasks:{total:84, done:61}, client:"Stellar Health", color:"#2563eb", tags:["Core","AI","Redesign"], category:"Engineering",
  },
  {
    id:"p2", name:"Dashboard Redesign",       description:"Complete overhaul of all dashboard views to align with new design system and improve data visualizations.",
    status:"In Review",  priority:"High",    progress:91, budget:45000,  spent:40950,
    startDate:"Nov 1, 2078",  dueDate:"Jan 31, 2079",
    members:[{initials:"CM",color:"#4ade80"},{initials:"HL",color:"#f87171"},{initials:"FC",color:"#2dd4bf"}],
    tasks:{total:36, done:33}, client:"Apex Technologies", color:"#db2777", tags:["Design","UI/UX"], category:"Design",
  },
  {
    id:"p3", name:"API Gateway v3",           description:"Unified API gateway to standardize all external integrations, add rate limiting, and improve security posture.",
    status:"Active",    priority:"High",     progress:45, budget:92000,  spent:41400,
    startDate:"Oct 15, 2078", dueDate:"Apr 15, 2079",
    members:[{initials:"IP",color:"#a78bfa"},{initials:"BT",color:"#60a5fa"},{initials:"ER",color:"#fb923c"}],
    tasks:{total:54, done:24}, client:"Polaris Cybersecurity", color:"#7c3aed", tags:["Infrastructure","Security","API"], category:"Engineering",
  },
  {
    id:"p4", name:"Data Pipeline Migration",  description:"Migrate ETL pipelines from legacy system to dbt + Spark. Covers 12 business domains and 200+ data models.",
    status:"Planning",  priority:"Medium",   progress:18, budget:68000,  spent:12240,
    startDate:"Jan 15, 2079", dueDate:"Jun 30, 2079",
    members:[{initials:"FC",color:"#2dd4bf"},{initials:"LO",color:"#e879f9"}],
    tasks:{total:42, done:8},  client:"Quantum Analytics", color:"#d97706", tags:["Data","Migration","dbt"], category:"Data",
  },
  {
    id:"p5", name:"Mobile App — iOS/Android", description:"Native-quality cross-platform mobile app using React Native. Covers core CRM features, push notifications, and offline mode.",
    status:"Active",    priority:"High",     progress:58, budget:135000, spent:78300,
    startDate:"Aug 1, 2078",  dueDate:"May 15, 2079",
    members:[{initials:"GK",color:"#facc15"},{initials:"ER",color:"#fb923c"},{initials:"AN",color:"#f472b6"}],
    tasks:{total:67, done:39}, client:"NovaBuild Corp", color:"#0891b2", tags:["Mobile","React Native","iOS","Android"], category:"Engineering",
  },
  {
    id:"p6", name:"Security Audit & Hardening","description":"Comprehensive security audit covering infrastructure, application layer, and access controls. Includes penetration testing.",
    status:"At Risk",   priority:"Critical", progress:34, budget:55000,  spent:18700,
    startDate:"Dec 1, 2078",  dueDate:"Feb 15, 2079",
    members:[{initials:"IP",color:"#a78bfa"},{initials:"KY",color:"#38bdf8"}],
    tasks:{total:28, done:10}, client:"Meridian Finance", color:"#dc2626", tags:["Security","Audit","Compliance"], category:"Infrastructure",
  },
  {
    id:"p7", name:"Partner Portal",           description:"Self-service portal for enterprise partners to manage integrations, view analytics, and submit support requests.",
    status:"On Hold",   priority:"Low",      progress:22, budget:75000,  spent:16500,
    startDate:"Nov 15, 2078", dueDate:"Jul 31, 2079",
    members:[{initials:"JS",color:"#34d399"},{initials:"DP",color:"#c084fc"}],
    tasks:{total:45, done:10}, client:"Orion Retail Group", color:"#64748b", tags:["Portal","Partner","Self-service"], category:"Product",
  },
  {
    id:"p8", name:"AI Assistant Integration", description:"Embed LLM-powered assistant into CRM UI for smart task suggestions, email drafting, and pipeline forecasting.",
    status:"Planning",  priority:"High",     progress:8,  budget:200000, spent:16000,
    startDate:"Feb 1, 2079",  dueDate:"Sep 30, 2079",
    members:[{initials:"AN",color:"#f472b6"},{initials:"FC",color:"#2dd4bf"},{initials:"BT",color:"#60a5fa"},{initials:"DP",color:"#c084fc"}],
    tasks:{total:58, done:5},  client:"Stellar Health", color:"#059669", tags:["AI","LLM","Innovation"], category:"Engineering",
  },
  {
    id:"p9", name:"Brand Identity Refresh",   description:"Complete brand refresh including logo, color system, typography, and iconography. Aligned with new product positioning.",
    status:"Completed", priority:"Medium",   progress:100,budget:28000,  spent:27160,
    startDate:"Jul 1, 2078",  dueDate:"Oct 31, 2078",
    members:[{initials:"CM",color:"#4ade80"},{initials:"HL",color:"#f87171"}],
    tasks:{total:24, done:24}, client:"Internal", color:"#8b5cf6", tags:["Brand","Design","Marketing"], category:"Design",
  },
];
