export interface Client {
  id: string;
  name: string;
  website: string;
  industry: string;
  tier: "Enterprise" | "Growth" | "Starter";
  status: "Active" | "At Risk" | "Churned" | "Prospect";
  mrr: number;
  totalRevenue: number;
  contacts: number;
  health: number; // 0-100
  lastActivity: string;
  joined: string;
  avatarColor: string;
  initials: string;
  country: string;
  employees: string;
  csm: string; // Customer Success Manager
  openDeals: number;
  tags: string[];
}

export const CLIENTS: Client[] = [
  { id:"c1",  name:"Apex Technologies",    website:"apextech.io",        industry:"SaaS",            tier:"Enterprise", status:"Active",   mrr:28500, totalRevenue:342000, contacts:8,  health:92, lastActivity:"2 hours ago",  joined:"Jan 2076", avatarColor:"#2563eb", initials:"AT", country:"USA",         employees:"500-1k",   csm:"Alice Nguyen",    openDeals:2, tags:["Key Account","Upsell"] },
  { id:"c2",  name:"NovaBuild Corp",       website:"novabuild.com",       industry:"Construction",    tier:"Growth",     status:"Active",   mrr:12400, totalRevenue:98720,  contacts:5,  health:78, lastActivity:"Yesterday",    joined:"Mar 2076", avatarColor:"#d97706", initials:"NB", country:"Canada",      employees:"100-500",  csm:"Bob Tran",        openDeals:1, tags:["Construction"] },
  { id:"c3",  name:"Meridian Finance",     website:"meridianfin.co",      industry:"FinTech",         tier:"Enterprise", status:"At Risk",  mrr:31200, totalRevenue:218400, contacts:12, health:41, lastActivity:"3 days ago",   joined:"Sep 2075", avatarColor:"#dc2626", initials:"MF", country:"UK",          employees:"200-500",  csm:"Diana Park",      openDeals:0, tags:["Renewal Risk","Key Account"] },
  { id:"c4",  name:"GreenPath Logistics",  website:"greenpath.io",        industry:"Logistics",       tier:"Growth",     status:"Active",   mrr:8750,  totalRevenue:52500,  contacts:4,  health:85, lastActivity:"Today",        joined:"Jun 2076", avatarColor:"#16a34a", initials:"GP", country:"Germany",     employees:"50-200",   csm:"Carlos Mendez",   openDeals:1, tags:["Expansion"] },
  { id:"c5",  name:"Stellar Health",       website:"stellarhealth.ai",    industry:"HealthTech",      tier:"Enterprise", status:"Active",   mrr:45800, totalRevenue:549600, contacts:15, health:96, lastActivity:"Today",        joined:"Feb 2075", avatarColor:"#7c3aed", initials:"SH", country:"USA",         employees:"1k-5k",    csm:"Alice Nguyen",    openDeals:3, tags:["Champion","Upsell","Key Account"] },
  { id:"c6",  name:"Quantum Analytics",    website:"quantumanaly.io",     industry:"Data & AI",       tier:"Starter",    status:"Prospect", mrr:0,     totalRevenue:0,      contacts:2,  health:65, lastActivity:"Last week",    joined:"Dec 2076", avatarColor:"#0891b2", initials:"QA", country:"Australia",   employees:"10-50",    csm:"Fiona Chen",      openDeals:1, tags:["Trial","Inbound"] },
  { id:"c7",  name:"Orion Retail Group",   website:"orionretail.co",      industry:"E-Commerce",      tier:"Growth",     status:"Active",   mrr:16300, totalRevenue:130400, contacts:6,  health:72, lastActivity:"2 days ago",   joined:"May 2076", avatarColor:"#db2777", initials:"OR", country:"France",      employees:"100-500",  csm:"Kevin Yamamoto",  openDeals:0, tags:["Retail"] },
  { id:"c8",  name:"Vanguard Education",   website:"vanguardedu.org",     industry:"EdTech",          tier:"Starter",    status:"Active",   mrr:3200,  totalRevenue:12800,  contacts:3,  health:88, lastActivity:"Yesterday",    joined:"Oct 2076", avatarColor:"#059669", initials:"VE", country:"Singapore",   employees:"10-50",    csm:"Laura Okafor",    openDeals:0, tags:["Education"] },
  { id:"c9",  name:"Summit Manufacturing", website:"summitmfg.co",        industry:"Manufacturing",   tier:"Enterprise", status:"At Risk",  mrr:22100, totalRevenue:265200, contacts:9,  health:38, lastActivity:"1 week ago",   joined:"Aug 2075", avatarColor:"#f97316", initials:"SM", country:"Japan",       employees:"500-1k",   csm:"Bob Tran",        openDeals:0, tags:["Renewal Risk","Churning"] },
  { id:"c10", name:"ClearWave Media",      website:"clearwave.media",     industry:"Media & Adtech",  tier:"Growth",     status:"Active",   mrr:9600,  totalRevenue:57600,  contacts:5,  health:81, lastActivity:"Today",        joined:"Jul 2076", avatarColor:"#8b5cf6", initials:"CW", country:"Brazil",      employees:"50-200",   csm:"Evan Reyes",      openDeals:1, tags:["Media"] },
  { id:"c11", name:"Polaris Cybersecurity", website:"polariscyber.io",    industry:"Cybersecurity",   tier:"Enterprise", status:"Active",   mrr:38700, totalRevenue:464400, contacts:11, health:94, lastActivity:"Today",        joined:"Apr 2075", avatarColor:"#475569", initials:"PC", country:"Israel",      employees:"200-500",  csm:"Alice Nguyen",    openDeals:2, tags:["Key Account","Security"] },
  { id:"c12", name:"Bloom AgriTech",       website:"bloomagri.tech",      industry:"AgriTech",        tier:"Starter",    status:"Churned",  mrr:0,     totalRevenue:8400,   contacts:2,  health:12, lastActivity:"2 months ago", joined:"Nov 2076", avatarColor:"#84cc16", initials:"BA", country:"India",       employees:"10-50",    csm:"Laura Okafor",    openDeals:0, tags:["Churned"] },
];
