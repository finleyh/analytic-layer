export const CATEGORY_COLORS: Record<string, [string, string]> = {
  cloud: ["#132033", "#4C8DFF"],
  satellite: ["#1C1530", "#8B5CF6"],
  educational: ["#13233A", "#60A5FA"],
  residential_isp: ["#0F2A27", "#2DD4BF"],
  wholesale_voip: ["#2A1322", "#EC4899"],
  mobile: ["#2A2013", "#F59E0B"],
  bph: ["#2A1316", "#E5484D"],
  reverse_proxy: ["#1E2023", "#A3A3A3"],
  unclassified: ["#0F3133", "#6FA89E"],
};

export function categoryColors(category: string): [string, string] {
  return CATEGORY_COLORS[category] ?? ["#1E2023", "#A3A3A3"];
}
