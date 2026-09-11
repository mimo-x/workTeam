"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  FileKey2,
  GitBranch,
  Grid3X3,
  Info,
  Layers3,
  LayoutGrid,
  MessageSquare,
  MonitorCog,
  Moon,
  MoveRight,
  Palette,
  Play,
  RotateCw,
  Send,
  ShieldCheck,
  Shapes,
  Sparkles,
  Sun,
  Type,
  UsersRound,
  WandSparkles,
  Workflow,
} from "lucide-react";

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAVIGATION = [
  { id: "overview", label: "设计基线", icon: Sparkles },
  { id: "color", label: "颜色 Color", icon: Palette },
  { id: "typography", label: "字体 Font", icon: Type },
  { id: "layout", label: "布局 Layout", icon: LayoutGrid },
  { id: "icon", label: "图标 Icon", icon: Shapes },
  { id: "style", label: "样式 Style", icon: Layers3 },
  { id: "motion", label: "动效 Motion", icon: WandSparkles },
  { id: "governance", label: "协作治理", icon: ShieldCheck },
  { id: "components", label: "shadcn 组件", icon: Code2 },
];

const PRINCIPLES = [
  {
    title: "准确",
    description: "状态、图标与操作含义保持明确，效率优先，不制造歧义。",
    icon: CheckCircle2,
  },
  {
    title: "简洁",
    description: "减少无效装饰，用轻量层级承载高密度协作信息。",
    icon: Sparkles,
  },
  {
    title: "一致",
    description: "人、Agent、群聊与 Task 共用同一套语义 Token 和组件状态。",
    icon: Grid3X3,
  },
  {
    title: "愉悦",
    description: "在不牺牲识别效率的前提下，提供自然、克制的情感反馈。",
    icon: WandSparkles,
  },
];

const CORE_COLORS = [
  { name: "Brand / Info", hex: "#1456F0", use: "主操作、链接、选中、信息" },
  { name: "Success", hex: "#32A645", use: "成功、完成、在线" },
  { name: "Warning", hex: "#ED6D0C", use: "提醒、风险、待处理" },
  { name: "Error", hex: "#F54A45", use: "错误、失败、危险操作" },
];

const NEUTRAL_COLORS = [
  { name: "Primary text", hex: "#1F2329", use: "主标题、一级正文" },
  { name: "Secondary text", hex: "#646A73", use: "副标题、二级正文" },
  { name: "Placeholder", hex: "#8F959E", use: "占位符、次要信息" },
  { name: "Disabled", hex: "#BBBFC4", use: "禁用文字与图标" },
  { name: "Control border", hex: "#D0D3D6", use: "输入框、可交互控件" },
  { name: "Card border", hex: "#DEE0E3", use: "卡片与内容容器" },
  { name: "Surface / hover", hex: "#EFF0F1", use: "悬浮、禁用控件背景" },
  { name: "Page surface", hex: "#F2F3F5", use: "栏、页面分组背景" },
  { name: "Subtle surface", hex: "#F5F6F7", use: "数据组与弱化区块" },
];

const SEMANTIC_MAPPING = [
  ["品牌蓝", "#1456F0", "--primary / --info", "Button、Link、选中态"],
  ["一级正文", "#1F2329", "--foreground", "标题、正文"],
  ["二级正文", "#646A73", "--muted-foreground", "说明、时间、辅助信息"],
  ["卡片描边", "#DEE0E3", "--border", "Card、Separator"],
  ["控件描边", "#D0D3D6", "--input", "Input、Select"],
  ["悬浮表面", "#EFF0F1", "--accent", "Hover、局部选择"],
  ["页面分组", "#F2F3F5", "--secondary", "Sidebar、分组背景"],
  ["数据分组", "#F5F6F7", "--muted", "弱化区、空状态"],
];

const TYPE_SCALE = [
  { name: "特大标题", size: 30, line: 46, weight: 600, use: "页面级标题" },
  { name: "一级标题", size: 24, line: 36, weight: 600, use: "大标题" },
  { name: "二级标题", size: 20, line: 30, weight: 500, use: "内容标题" },
  { name: "三级标题", size: 18, line: 28, weight: 500, use: "内容标题" },
  { name: "四级标题", size: 16, line: 24, weight: 500, use: "群名、弹窗标题" },
  { name: "五级标题", size: 16, line: 24, weight: 400, use: "标题型 Tab" },
  {
    name: "辅助标题",
    size: 14,
    line: 22,
    weight: 500,
    use: "列表、会话、按钮",
  },
  { name: "正文", size: 14, line: 22, weight: 400, use: "消息、列表、表单" },
  { name: "正文辅助", size: 12, line: 20, weight: 400, use: "时间、描述" },
  { name: "辅助", size: 12, line: 20, weight: 500, use: "标签强调文字" },
  { name: "最小辅助", size: 10, line: 16, weight: 400, use: "Badge、极小标签" },
];

const RADIUS_SCALE = [
  { name: "Radius-XS", value: "4px", use: "Tag、Checkbox、Section card" },
  { name: "Radius-S", value: "6px", use: "Button、Input、Select、Toast" },
  { name: "Radius-M", value: "8px", use: "Dialog、Popover、Toolbar" },
  { name: "Radius-L", value: "10px", use: "复杂卡片、全屏模态、List" },
  { name: "Radius-XL", value: "999px", use: "Avatar、Badge、Switch、Radio" },
];

const ICON_LEVELS = [
  {
    title: "一级 · 导航",
    description: "主导航使用面型或较强视觉权重，既表达产品身份，也承担交互。",
    icons: [MessageSquare, UsersRound, Bot],
  },
  {
    title: "二级 · 操作",
    description: "侧栏、工具栏、页头使用线型图标，保持清晰和统一。",
    icons: [Send, Copy, RotateCw],
  },
  {
    title: "三级 · 语义",
    description: "输入框与基础模块使用弱对比线型图标，突出语义，不争夺注意力。",
    icons: [Info, Clock3, CircleAlert],
  },
];

const MOTION_EFFECTS = [
  {
    name: "位移",
    idle: "translate-x-0",
    active: "translate-x-8",
    icon: MoveRight,
  },
  { name: "缩放", idle: "scale-100", active: "scale-110", icon: Sparkles },
  { name: "旋转", idle: "rotate-0", active: "rotate-45", icon: RotateCw },
  { name: "透明度", idle: "opacity-35", active: "opacity-100", icon: Layers3 },
];

const SOURCE_LINKS = [
  ["颜色", "https://open.feishu.cn/document/design-specification/design-language/color"],
  ["布局", "https://open.feishu.cn/document/design-specification/design-language/layout"],
  ["动效", "https://open.feishu.cn/document/design-specification/design-language/animation"],
  ["图标", "https://open.feishu.cn/document/design-specification/design-language/icon"],
  ["样式", "https://open.feishu.cn/document/design-specification/design-language/style"],
  ["字体", "https://open.feishu.cn/document/design-specification/design-language/font"],
];

const TOKEN_TEXT = `:root {
  --primary: #1456f0;
  --foreground: #1f2329;
  --muted-foreground: #646a73;
  --destructive: #f54a45;
  --success: #32a645;
  --warning: #ed6d0c;
  --governance-ready: var(--success);
  --governance-waiting: var(--warning);
  --governance-blocked: var(--destructive);
  --governance-agent: var(--info);
  --border: #dee0e3;
  --input: #d0d3d6;
  --accent: #eff0f1;
  --secondary: #f2f3f5;
  --muted: #f5f6f7;
  --radius: 0.375rem;
}`;

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <span className="text-xs font-medium tracking-[0.14em] text-primary uppercase">
        {eyebrow}
      </span>
      <h2 className="text-2xl leading-9 font-semibold md:text-3xl md:leading-[46px]">{title}</h2>
      <p className="text-sm leading-[22px] text-muted-foreground">{description}</p>
    </div>
  );
}

function SpecCard({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof Sparkles;
}) {
  return (
    <Card size="sm" className="shadow-none">
      <CardHeader>
        <div className="mb-1 flex size-8 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
          <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
        </div>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-[22px] text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function ColorSwatch({
  name,
  hex,
  use,
  compact = false,
}: {
  name: string;
  hex: string;
  use: string;
  compact?: boolean;
}) {
  const needsDarkText = ["#EFF0F1", "#F2F3F5", "#F5F6F7", "#D0D3D6", "#DEE0E3"].includes(hex);

  return (
    <div className="overflow-hidden rounded-[8px] border bg-card">
      <div
        className={cn("flex items-end p-3", compact ? "h-16" : "h-24")}
        style={{
          backgroundColor: hex,
          color: needsDarkText ? "#1F2329" : "#FFFFFF",
        }}
      >
        <span className="text-xs font-medium">{hex}</span>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{use}</p>
      </div>
    </div>
  );
}

function RuleList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm leading-[22px] text-muted-foreground">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <Check
            className="mt-1 size-3.5 shrink-0 text-success"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function WorkTeamDesignSystem() {
  const [isDark, setIsDark] = useState(false);
  const [copied, setCopied] = useState(false);
  const [motionActive, setMotionActive] = useState(false);

  useEffect(() => {
    const nextTheme = localStorage.getItem("codex.theme") === "dark";
    document.documentElement.classList.toggle("dark", nextTheme);
    setIsDark(nextTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = !isDark;
    setIsDark(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme);
    localStorage.setItem("codex.theme", nextTheme ? "dark" : "light");
  };

  const copyTokens = async () => {
    await navigator.clipboard.writeText(TOKEN_TEXT);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const replayMotion = () => {
    setMotionActive(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setMotionActive(true));
    });
  };

  return (
    <ScrollArea className="h-screen bg-background text-foreground">
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-lg">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between px-4 md:px-8">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-[8px] bg-primary text-primary-foreground shadow-[var(--shadow-primary)]">
                <Bot className="size-4" strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">WorkTeam</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  Design System
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="secondary">Feishu × shadcn</Badge>
              <Separator orientation="vertical" className="mx-1 h-5" />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
                      onClick={toggleTheme}
                    />
                  }
                >
                  {isDark ? <Sun /> : <Moon />}
                </TooltipTrigger>
                <TooltipContent>{isDark ? "浅色模式" : "深色模式"}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[232px_minmax(0,1fr)]">
          <aside className="hidden border-r bg-secondary/45 lg:block">
            <nav className="sticky top-14 flex h-[calc(100vh-3.5rem)] flex-col gap-1 p-5">
              <span className="mb-2 px-2 text-xs font-medium text-muted-foreground">设计语言</span>
              {NAVIGATION.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground"
                  >
                    <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
                    {item.label}
                  </a>
                );
              })}

              <div className="mt-auto rounded-[8px] border bg-card p-3 shadow-[var(--shadow-down-1)]">
                <p className="text-xs font-medium">实现基线</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Brand #1456F0
                  <br />
                  Body 14 / 22
                  <br />
                  shadcn · Base UI
                </p>
              </div>
            </nav>
          </aside>

          <main className="min-w-0">
            <section
              id="overview"
              className="scroll-mt-16 border-b bg-[radial-gradient(circle_at_88%_12%,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_34%)] px-4 py-16 md:px-10 md:py-20"
            >
              <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <div className="flex max-w-4xl flex-col gap-6">
                  <Badge
                    variant="outline"
                    className="w-fit border-primary/20 bg-primary/5 text-primary"
                  >
                    WorkTeam design language · 2026
                  </Badge>
                  <div className="flex flex-col gap-4">
                    <h1 className="max-w-4xl text-[30px] leading-[46px] font-semibold md:text-[42px] md:leading-[58px]">
                      飞书式高效协作，
                      <br className="hidden sm:block" />用 shadcn 稳定实现。
                    </h1>
                    <p className="max-w-2xl text-sm leading-[22px] text-muted-foreground md:text-base md:leading-6">
                      WorkTeam 采用飞书的颜色、布局、字体、图标、圆角与动效原则，并通过 shadcn
                      组件和语义 Token 统一聊天、Agent 与 Task 的产品体验。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => document.querySelector("#color")?.scrollIntoView()}>
                      浏览设计规范
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                    <Button variant="outline" onClick={copyTokens}>
                      {copied ? (
                        <Check data-icon="inline-start" />
                      ) : (
                        <Copy data-icon="inline-start" />
                      )}
                      {copied ? "已复制" : "复制核心 Token"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {PRINCIPLES.map((principle) => (
                    <SpecCard key={principle.title} {...principle} />
                  ))}
                </div>

                <div className="flex gap-3 rounded-[8px] border border-primary/20 bg-primary/5 p-4">
                  <Info className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2} />
                  <p className="text-sm leading-[22px]">
                    <span className="font-medium">实现边界：</span>
                    飞书规范决定视觉原则与基础数值；shadcn 决定组件结构、可访问性和组合方式。
                    深色模式是 WorkTeam 基于同一语义层级扩展的主题。
                  </p>
                </div>
              </div>
            </section>

            <section id="color" className="scroll-mt-14 px-4 py-16 md:px-10 md:py-20">
              <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <SectionHeading
                  eyebrow="01 · Color"
                  title="颜色：以品牌蓝建立清晰的操作焦点"
                  description="品牌色只承担关键操作与信息强调；成功、警告、错误遵守用户的固有认知；大面积内容使用中性色建立层级。"
                />

                <div>
                  <h3 className="mb-4 text-base leading-6 font-medium">品牌色与功能色</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {CORE_COLORS.map((color) => (
                      <ColorSwatch key={color.name} {...color} />
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-4 text-base leading-6 font-medium">中性色与界面层级</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {NEUTRAL_COLORS.map((color) => (
                      <ColorSwatch key={color.name} {...color} compact />
                    ))}
                  </div>
                </div>

                <Card className="shadow-none">
                  <CardHeader>
                    <CardTitle>飞书语义 → shadcn Token</CardTitle>
                    <CardDescription>
                      业务代码只消费语义 Token，不直接写颜色值，明暗主题无需改变组件逻辑。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto px-0">
                    <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-y bg-muted/70 text-xs text-muted-foreground">
                          <th className="px-4 py-2 font-medium">飞书语义</th>
                          <th className="px-4 py-2 font-medium">色值</th>
                          <th className="px-4 py-2 font-medium">shadcn Token</th>
                          <th className="px-4 py-2 font-medium">使用场景</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SEMANTIC_MAPPING.map(([semantic, value, token, use]) => (
                          <tr key={semantic} className="border-b last:border-0">
                            <td className="px-4 py-3 font-medium">{semantic}</td>
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                              {value}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-primary">{token}</td>
                            <td className="px-4 py-3 text-muted-foreground">{use}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>
            </section>

            <Separator />

            <section id="typography" className="scroll-mt-14 px-4 py-16 md:px-10 md:py-20">
              <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <SectionHeading
                  eyebrow="02 · Font"
                  title="字体：用字阶建立内容节奏"
                  description="PC 端遵循飞书 10–30px 字阶。常规界面只使用 Regular 400 与 Medium 500，Semibold 600 仅用于页面级与大标题。"
                />

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.55fr)]">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>PC 字阶</CardTitle>
                      <CardDescription>字号 / 行高 / 字重均来自飞书字体规范。</CardDescription>
                    </CardHeader>
                    <CardContent className="px-0">
                      {TYPE_SCALE.map((type, index) => (
                        <div
                          key={type.name}
                          className={cn(
                            "grid items-center gap-3 px-4 py-3 sm:grid-cols-[108px_1fr_160px]",
                            index !== TYPE_SCALE.length - 1 && "border-b",
                          )}
                        >
                          <div>
                            <p className="text-xs font-medium">{type.name}</p>
                            <code className="text-[10px] leading-4 text-muted-foreground">
                              {type.size} / {type.line} · {type.weight}
                            </code>
                          </div>
                          <p
                            className="truncate"
                            style={{
                              fontSize: `${type.size}px`,
                              lineHeight: `${type.line}px`,
                              fontWeight: type.weight,
                            }}
                          >
                            人与 Agent 高效协作
                          </p>
                          <p className="hidden text-xs text-muted-foreground sm:block">
                            {type.use}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <div className="flex flex-col gap-4">
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle>字重</CardTitle>
                        <CardDescription>避免使用过多字重制造虚假层级。</CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-5">
                        {[
                          ["Regular", "400", "正文、描述、标签"],
                          ["Medium", "500", "组件标题、按钮、强调"],
                          ["Semibold", "600", "页面级与大标题"],
                        ].map(([name, value, use]) => (
                          <div key={name}>
                            <p style={{ fontWeight: Number(value) }} className="text-base">
                              {name} {value}
                            </p>
                            <p className="text-xs text-muted-foreground">{use}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle>文字颜色</CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        <p className="text-sm text-foreground">一级正文 · #1F2329</p>
                        <p className="text-sm text-muted-foreground">二级正文 · #646A73</p>
                        <p className="text-sm text-[#8F959E]">次要信息 · #8F959E</p>
                        <p className="text-sm text-[#BBBFC4]">禁用文字 · #BBBFC4</p>
                        <a href="#color" className="text-sm text-primary hover:underline">
                          链接与菜单选中 · #1456F0
                        </a>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </section>

            <Separator />

            <section
              id="layout"
              className="scroll-mt-14 bg-secondary/35 px-4 py-16 md:px-10 md:py-20"
            >
              <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <SectionHeading
                  eyebrow="03 · Layout"
                  title="布局：根据任务选择信息密度"
                  description="高密度用于浏览、批量与快速操作；低密度用于聚焦任务、重要提醒和需要安全点击区域的场景。"
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>高密度 · 浏览与协作</CardTitle>
                      <CardDescription>好友列表、会话列表、消息流、Task 面板。</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-1">
                      {[
                        ["组件负责人", "已完成接口字段核对", "16:32"],
                        ["设计评审群", "@你 请确认任务详情", "15:48"],
                        ["研究 Agent", "已整理 12 个有效来源", "14:20"],
                      ].map(([name, message, time]) => (
                        <div
                          key={name}
                          className="grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
                        >
                          <Avatar size="sm">
                            <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{name}</p>
                            <p className="truncate text-xs text-muted-foreground">{message}</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{time}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>低密度 · 聚焦与确认</CardTitle>
                      <CardDescription>任务审核、危险操作、复杂表单、关键提醒。</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-[8px] border bg-muted/60 p-5">
                        <div className="flex gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
                            <CircleAlert className="size-5" />
                          </div>
                          <div>
                            <p className="text-base font-medium">开始执行这个 Task？</p>
                            <p className="mt-2 text-sm leading-[22px] text-muted-foreground">
                              Agent
                              将读取群聊上下文并写入工作区。审核人及执行记录会保留在任务时间线中。
                            </p>
                          </div>
                        </div>
                        <div className="mt-6 flex justify-end gap-2">
                          <Button variant="outline">返回修改</Button>
                          <Button>确认执行</Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Card size="sm" className="shadow-none">
                    <CardHeader>
                      <CardTitle>水平对齐</CardTitle>
                      <CardDescription>同一层级元素保持左、右或中心线一致。</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {[72, 100, 84].map((width) => (
                        <div key={width} className="flex h-8 items-center rounded-md bg-muted px-2">
                          <div
                            className="h-2 rounded-full bg-primary/70"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card size="sm" className="shadow-none">
                    <CardHeader>
                      <CardTitle>自适应</CardTitle>
                      <CardDescription>固定区保持稳定，内容区按窗口伸缩。</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid h-[108px] grid-cols-[42px_1fr_28px] gap-2">
                        <div className="rounded-md bg-primary/15" />
                        <div className="rounded-md border border-dashed border-primary/40 bg-primary/5" />
                        <div className="rounded-md bg-muted" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card size="sm" className="shadow-none">
                    <CardHeader>
                      <CardTitle>表单布局</CardTitle>
                      <CardDescription>宽容器右对齐标签；窄容器改为纵向左对齐。</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <div className="grid grid-cols-[72px_1fr] items-center gap-3">
                        <label className="text-right text-xs text-muted-foreground">
                          Agent 名称
                        </label>
                        <div className="h-8 rounded-md border bg-background" />
                      </div>
                      <div className="grid grid-cols-[72px_1fr] items-center gap-3">
                        <label className="text-right text-xs text-muted-foreground">可见范围</label>
                        <div className="h-8 rounded-md border bg-background" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="rounded-[8px] border bg-card p-4">
                  <p className="text-sm font-medium">WorkTeam 间距映射</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    飞书布局规范定义密度与对齐原则；工程侧采用 4px 基础步进： 4 / 8 / 12 / 16 / 24 /
                    32px。数字表格统一有效位并右对齐。
                  </p>
                </div>
              </div>
            </section>

            <Separator />

            <section id="icon" className="scroll-mt-14 px-4 py-16 md:px-10 md:py-20">
              <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <SectionHeading
                  eyebrow="04 · Icon"
                  title="图标：Lucide 形态，飞书规则"
                  description="统一使用 Lucide 图标并遵循飞书的尺寸、线宽、层级和像素对齐原则。图标用于提高识别效率，不作为装饰。"
                />

                <div className="grid gap-4 lg:grid-cols-3">
                  {ICON_LEVELS.map((level) => (
                    <Card key={level.title} size="sm" className="shadow-none">
                      <CardHeader>
                        <CardTitle>{level.title}</CardTitle>
                        <CardDescription className="leading-[22px]">
                          {level.description}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex gap-2">
                        {level.icons.map((Icon, index) => (
                          <div
                            key={index}
                            className={cn(
                              "flex size-10 items-center justify-center rounded-[8px]",
                              level.title.startsWith("一级")
                                ? "bg-primary text-primary-foreground"
                                : level.title.startsWith("二级")
                                  ? "bg-secondary text-[var(--icon-primary)] dark:text-foreground"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            <Icon className="size-5" strokeWidth={2} />
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>标准输出尺寸</CardTitle>
                      <CardDescription>以 24×24px 为统一绘制基础栅格。</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-4 gap-3">
                      {[16, 20, 24, 32].map((size) => (
                        <div
                          key={size}
                          className="flex flex-col items-center gap-3 rounded-[8px] bg-muted p-4"
                        >
                          <Send style={{ width: size, height: size }} strokeWidth={2} />
                          <code className="text-[10px] text-muted-foreground">{size}px</code>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>绘制与使用</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <RuleList
                        items={[
                          "24px 画布保留 22px 活动区域与四周 1px 空隙。",
                          "标准线型图标使用 2px 线宽；复杂图形可使用 1.5px。",
                          "默认系统图标使用 #2B2F36，与文字并排时明度低于文字。",
                          "坐标尽量使用整数，并进行视觉重心校准。",
                        ]}
                      />
                    </CardContent>
                  </Card>
                </div>
              </div>
            </section>

            <Separator />

            <section
              id="style"
              className="scroll-mt-14 bg-secondary/35 px-4 py-16 md:px-10 md:py-20"
            >
              <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <SectionHeading
                  eyebrow="05 · Style"
                  title="样式：轻圆角、轻投影、清楚分层"
                  description="组件面积越大，圆角通常越大。优先用背景和描边区分同一高程，仅在确有高程关系时使用轻量投影。"
                />

                <Card className="shadow-none">
                  <CardHeader>
                    <CardTitle>圆角层级</CardTitle>
                    <CardDescription>shadcn 组件按面积和交互类型映射到五级圆角。</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {RADIUS_SCALE.map((radius) => (
                      <div key={radius.name} className="flex flex-col gap-3">
                        <div
                          className="flex aspect-square items-center justify-center border bg-muted"
                          style={{ borderRadius: radius.value }}
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {radius.value}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-medium">{radius.name}</p>
                          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                            {radius.use}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Card size="sm" className="shadow-[var(--shadow-down-1)]">
                    <CardHeader>
                      <CardTitle>Shadow S1</CardTitle>
                      <CardDescription>局部组件与轻浮层</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <code className="text-[10px] text-muted-foreground">--shadow-down-1</code>
                    </CardContent>
                  </Card>
                  <Card size="sm" className="shadow-[var(--shadow-down-3)]">
                    <CardHeader>
                      <CardTitle>Shadow S3</CardTitle>
                      <CardDescription>Popover、Dialog、悬浮卡片</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <code className="text-[10px] text-muted-foreground">--shadow-down-3</code>
                    </CardContent>
                  </Card>
                  <Card size="sm" className="shadow-[var(--shadow-primary)]">
                    <CardHeader>
                      <CardTitle>Primary shadow</CardTitle>
                      <CardDescription>品牌色聚焦对象，谨慎使用</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <code className="text-[10px] text-muted-foreground">--shadow-primary</code>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>描边</CardTitle>
                      <CardDescription>同一高程的信息模块用 1px 描边或分割线组织。</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      {[
                        ["#D0D3D6", "可交互控件", "Input、Select、Checkbox"],
                        ["#DEE0E3", "卡片描边", "Card、Panel"],
                        ["#1F2329 / 15%", "内容分割线", "Feed、设置页、List"],
                      ].map(([value, name, use]) => (
                        <div key={name} className="grid grid-cols-[48px_1fr] items-center gap-3">
                          <div
                            className="h-px w-12"
                            style={{
                              background: value === "#1F2329 / 15%" ? "rgb(31 35 41 / 15%)" : value,
                            }}
                          />
                          <div>
                            <p className="text-xs font-medium">{name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {value} · {use}
                            </p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>背景与遮罩</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                      {[
                        ["#EFF0F1", "Hover / Disabled"],
                        ["#F2F3F5", "页面 / 栏"],
                        ["#F5F6F7", "数据分组"],
                        ["rgba(0,0,0,.55)", "模态遮罩"],
                      ].map(([value, use]) => (
                        <div key={value}>
                          <div className="h-12 rounded-md border" style={{ background: value }} />
                          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                            {value}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{use}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </section>

            <Separator />

            <section id="motion" className="scroll-mt-14 px-4 py-16 md:px-10 md:py-20">
              <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
                  <SectionHeading
                    eyebrow="06 · Animation"
                    title="动效：快速响应，自然结束"
                    description="优先对位移、缩放、旋转、透明度和颜色做过渡。进入使用减速，离开使用加速；消失时长应短于出现。"
                  />
                  <Button variant="outline" onClick={replayMotion}>
                    <Play data-icon="inline-start" />
                    播放示例
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {MOTION_EFFECTS.map((effect) => {
                    const Icon = effect.icon;
                    return (
                      <Card key={effect.name} size="sm" className="shadow-none">
                        <CardHeader>
                          <CardTitle>{effect.name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex h-20 items-center rounded-[8px] bg-muted px-4">
                            <div
                              className={cn(
                                "flex size-9 items-center justify-center rounded-[8px] bg-primary text-primary-foreground transition-[transform,opacity,background-color] motion-reduce:transition-none",
                                motionActive ? effect.active : effect.idle,
                              )}
                              style={{
                                transitionDuration: "var(--motion-duration-slow)",
                                transitionTimingFunction: "var(--motion-ease-standard)",
                              }}
                            >
                              <Icon className="size-4" strokeWidth={2} />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>WorkTeam 时长映射</CardTitle>
                      <CardDescription>
                        下列数值是依据飞书动效原则制定的工程实现，而非飞书页面公布的固定参数。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      {[
                        ["Fast", "100ms", "Hover、颜色、轻微状态"],
                        ["Base", "200ms", "控件展开、反馈、淡入"],
                        ["Slow", "300ms", "面板位移、较大范围变化"],
                      ].map(([name, value, use]) => (
                        <div
                          key={name}
                          className="grid grid-cols-[64px_64px_1fr] items-center gap-3"
                        >
                          <span className="text-xs font-medium">{name}</span>
                          <code className="text-xs text-primary">{value}</code>
                          <span className="text-xs text-muted-foreground">{use}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>曲线与交付</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <RuleList
                        items={[
                          "Standard：快速响应，慢速结束，适合屏内状态变化。",
                          "Decelerate：进入屏幕时减速，让对象自然落位。",
                          "Accelerate：离开屏幕时加速，缩短退出感知。",
                          "每个动效需记录触发方式、对象、属性、时长与曲线。",
                          "遵循 prefers-reduced-motion，关闭非必要位移。",
                        ]}
                      />
                    </CardContent>
                  </Card>
                </div>
              </div>
            </section>

            <Separator />

            <section
              id="governance"
              className="scroll-mt-14 bg-secondary/35 px-4 py-16 md:px-10 md:py-20"
            >
              <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <SectionHeading
                  eyebrow="07 · Governed collaboration"
                  title="协作治理：让权限边界在工作流中可见"
                  description="人和 Agent 共用一个群聊，但执行权不等于发言权。界面始终说明当前项目主机、Task 范围、责任人、预算、等待原因与下一步操作。"
                />

                <div className="flex gap-3 rounded-[8px] border border-primary/20 bg-primary/5 p-4">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <p className="text-sm leading-[22px]">
                    <span className="font-medium">双重授权：</span>
                    群主或管理员审核“团队是否要做”；项目主机所有者审核“这台电脑是否允许做”。两项决定必须独立呈现，不能合并成一个模糊的“允许”。
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  {[
                    {
                      title: "群成员",
                      description:
                        "发言、@ Agent、提出 Task、查看脱敏进度；不能审核或扩大执行范围。",
                      icon: UsersRound,
                    },
                    {
                      title: "群主 / 管理员",
                      description:
                        "审核计划、选择项目主机、开始或验收 Task；看不到主机私密路径和凭据。",
                      icon: ShieldCheck,
                    },
                    {
                      title: "项目主机所有者",
                      description:
                        "登记电脑、声明基线能力、批准具体 Runtime 操作；不替代群管理员决策。",
                      icon: MonitorCog,
                    },
                  ].map((role) => (
                    <SpecCard key={role.title} {...role} />
                  ))}
                </div>

                <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>项目主机与路径隐私</CardTitle>
                      <CardDescription>
                        群内共享稳定身份和就绪状态；本机绝对路径、设备密钥与 Runtime
                        详情永不进入群消息。
                      </CardDescription>
                      <CardAction>
                        <Badge className="bg-governance-ready/10 text-governance-ready">在线</Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-start gap-3 rounded-md border bg-background p-3">
                        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-success/10 text-success">
                          <GitBranch className="size-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">Agent Team · MacBook Pro</p>
                            <Badge variant="outline">v3</Badge>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            github.com/team/agent-team · 所有者 我
                          </p>
                        </div>
                      </div>
                      <RuleList
                        items={[
                          "默认基线只有 workspace.read；写文件、命令和网络能力由主机逐项声明。",
                          "Task 固定绑定主机 ID 与 revision，主机切换或 Task 改版后旧授权失效。",
                          "离线时进入等待态并保留上下文，不静默转移到其他电脑。",
                        ]}
                      />
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>权限层级</CardTitle>
                      <CardDescription>越接近真实副作用，授权越具体、有效期越短。</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {[
                        ["L0", "群聊与分析", "自动", "workspace.read"],
                        ["L1", "Task 范围", "主机授权", "path / command / domain"],
                        ["L2", "具体电脑操作", "逐次确认", "仅一次 / 本 Task"],
                        ["L3", "首发不开放", "明确阻止", "发布、部署、破坏性远端操作"],
                      ].map(([level, name, approval, scope]) => (
                        <div
                          key={level}
                          className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-md border bg-background px-3 py-2"
                        >
                          <Badge variant="outline" className="justify-center font-mono">
                            {level}
                          </Badge>
                          <div>
                            <p className="text-xs font-medium">{name}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">{scope}</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{approval}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>Task tree 与预算</CardTitle>
                      <CardDescription>
                        委派关系使用树表达；每个子 Task 显示执行者、能力范围和可解释状态。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="overflow-hidden rounded-[8px] border bg-background">
                        <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2.5">
                          <Workflow className="size-4 text-primary" aria-hidden="true" />
                          <span className="min-w-0 flex-1 text-sm font-medium">
                            分析登录超时并交付修复
                          </span>
                          <Badge variant="outline">根 Task</Badge>
                        </div>
                        {[
                          ["定位 WebSocket 降级原因", "诊断 Agent", "执行中", "text-primary"],
                          ["补充回归 Case", "测试 Agent", "等待权限", "text-warning"],
                          ["汇总结果与证据", "协调 Agent", "阻塞", "text-destructive"],
                        ].map(([title, agent, status, color]) => (
                          <div
                            key={title}
                            className="grid grid-cols-[1rem_1fr_auto] items-center gap-2 border-b px-3 py-2.5 last:border-b-0"
                          >
                            <span className="text-muted-foreground">└</span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">{title}</p>
                              <p className="text-[10px] text-muted-foreground">{agent} · L1</p>
                            </div>
                            <span className={cn("text-[10px]", color)}>{status}</span>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          ["深度", "1 / 3"],
                          ["子 Task", "3 / 12"],
                          ["Runs", "5 / 24"],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-md bg-muted p-2 text-center">
                            <p className="font-mono text-xs font-medium">{value}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>电脑操作审批卡</CardTitle>
                      <CardDescription>
                        只呈现可决策的信息：谁、为何、对什么精确范围、允许多久。
                      </CardDescription>
                      <CardAction>
                        <Badge className="bg-governance-waiting/10 text-governance-waiting">
                          待处理
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-start gap-3 rounded-md border border-warning/25 bg-warning/5 p-3">
                        <FileKey2
                          className="mt-0.5 size-4 shrink-0 text-warning"
                          aria-hidden="true"
                        />
                        <div>
                          <p className="text-sm font-medium">运行测试命令</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            测试 Agent 为验证登录回归请求在当前项目主机运行命令。
                          </p>
                          <div className="mt-2 rounded bg-background px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                            command.run · npm · Task v2
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Button size="sm" variant="outline">
                          拒绝
                        </Button>
                        <Button size="sm" variant="outline">
                          仅这一次
                        </Button>
                        <Button size="sm">本 Task</Button>
                      </div>
                      <p className="text-[10px] leading-4 text-muted-foreground">
                        “本 Task”只在同一 Task
                        revision、同一主机和同一精确约束内复用；不要提供“永久允许”。
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="shadow-none">
                  <CardHeader>
                    <CardTitle>群聊消息与治理状态</CardTitle>
                    <CardDescription>
                      内容优先、装饰克制。自己发送的短消息使用紧凑气泡，Agent 输出保留更宽的阅读列。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                    <div className="space-y-5 rounded-[8px] border bg-background p-4">
                      <div className="flex gap-3">
                        <Avatar size="sm">
                          <AvatarFallback className="bg-primary/10 text-primary">研</AvatarFallback>
                        </Avatar>
                        <div className="max-w-[82%]">
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="font-medium text-foreground">研究 Agent</span>
                            16:32
                          </div>
                          <p className="mt-1 text-sm leading-[22px]">
                            已完成初步分析，并委派测试 Agent 验证登录超时的边界条件。
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <div className="max-w-[68%]">
                          <div className="mb-1 text-right text-[10px] text-muted-foreground">
                            16:35 · 我
                          </div>
                          <div className="rounded-xl rounded-tr-sm border border-primary/15 bg-primary/8 px-3 py-2 text-[13px] leading-6">
                            好，先验证再合并。
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xs font-medium">状态词与视觉语义</h3>
                      <div className="mt-3 space-y-2">
                        {[
                          ["就绪 / 完成", "--governance-ready", "bg-governance-ready"],
                          ["等待人工 / 离线", "--governance-waiting", "bg-governance-waiting"],
                          ["阻塞 / 失败", "--governance-blocked", "bg-governance-blocked"],
                          ["Agent / 信息", "--governance-agent", "bg-governance-agent"],
                        ].map(([label, token, color]) => (
                          <div key={label} className="flex items-center gap-2 text-xs">
                            <span className={cn("size-2 rounded-full", color)} />
                            <span className="min-w-0 flex-1">{label}</span>
                            <code className="text-[10px] text-muted-foreground">{token}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-3">
                  <Card size="sm" className="shadow-none">
                    <CardHeader>
                      <CardTitle>等待态</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="rounded-md bg-warning/10 p-2 text-xs leading-5 text-warning">
                        等待项目主机上线。上线后自动续跑，无需重新创建 Task。
                      </p>
                    </CardContent>
                  </Card>
                  <Card size="sm" className="shadow-none">
                    <CardHeader>
                      <CardTitle>空状态</CardTitle>
                    </CardHeader>
                    <CardContent className="text-center">
                      <MonitorCog className="mx-auto size-5 text-muted-foreground" />
                      <p className="mt-2 text-xs">群里还没有项目主机</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        说明原因并给出唯一下一步。
                      </p>
                    </CardContent>
                  </Card>
                  <Card size="sm" className="shadow-none">
                    <CardHeader>
                      <CardTitle>错误态</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="rounded-md bg-destructive/10 p-2 text-xs leading-5 text-destructive">
                        授权已因 Task 版本变化失效，请核对新范围后重新授权。
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <RuleList
                  items={[
                    "等待、阻塞、失败必须使用不同文案，并给出谁可以继续推进以及具体下一步。",
                    "审计时间线默认紧凑展示事件、结果和时间；复制诊断前必须移除本机路径与凭据。",
                    "Agent 委派必须显示父子关系、执行者、范围和预算，不使用看不见的后台自动化。",
                    "明暗主题使用同一语义 Token；颜色只作辅助，状态仍需图标或文字标签。",
                  ]}
                />
              </div>
            </section>

            <Separator />

            <section id="components" className="scroll-mt-14 px-4 py-16 md:px-10 md:py-20">
              <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <SectionHeading
                  eyebrow="08 · shadcn"
                  title="组件：保持 shadcn 结构，使用飞书视觉 Token"
                  description="组件继续使用项目内的 shadcn/Base UI 实现，颜色、圆角、边框、字体和动效统一消费本设计系统变量。"
                />

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>操作与状态</CardTitle>
                      <CardDescription>
                        同一区域只保留一个主操作，状态不只依赖颜色表达。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-5">
                      <div className="flex flex-wrap gap-2">
                        <Button>主要操作</Button>
                        <Button variant="secondary">次要操作</Button>
                        <Button variant="outline">描边按钮</Button>
                        <Button variant="ghost">文字按钮</Button>
                        <Button variant="destructive">危险操作</Button>
                      </div>
                      <Separator />
                      <div className="flex flex-wrap gap-2">
                        <Badge className="bg-success/10 text-success">已完成</Badge>
                        <Badge className="bg-warning/10 text-warning">待审核</Badge>
                        <Badge variant="destructive">已阻塞</Badge>
                        <Badge variant="secondary">草稿</Badge>
                        <Badge variant="outline">只读</Badge>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>表单</CardTitle>
                      <CardDescription>
                        控件保持 6px 圆角，并提供明确标签、占位符与权限说明。
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2">
                      <Input aria-label="Agent 名称" placeholder="输入 Agent 名称" />
                      <Select defaultValue="reviewer">
                        <SelectTrigger className="w-full" aria-label="选择 Agent 角色">
                          <SelectValue placeholder="选择角色" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Agent 角色</SelectLabel>
                            <SelectItem value="architect">架构师</SelectItem>
                            <SelectItem value="developer">程序员</SelectItem>
                            <SelectItem value="reviewer">审查员</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Textarea
                        aria-label="Agent 职责"
                        className="sm:col-span-2"
                        placeholder="描述 Agent 的职责、Skills 与权限边界…"
                      />
                      <div className="flex items-center justify-between sm:col-span-2">
                        <div>
                          <p className="text-sm font-medium">公开 Agent</p>
                          <p className="text-xs text-muted-foreground">允许好友将它添加到群聊</p>
                        </div>
                        <Switch aria-label="公开 Agent" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>群聊消息模式</CardTitle>
                      <CardDescription>
                        Agent 感知群名、成员与实时上下文，并可 @ 其他成员。
                      </CardDescription>
                      <CardAction>
                        <AvatarGroup>
                          <Avatar size="sm">
                            <AvatarFallback>我</AvatarFallback>
                          </Avatar>
                          <Avatar size="sm">
                            <AvatarFallback>前</AvatarFallback>
                          </Avatar>
                          <Avatar size="sm">
                            <AvatarFallback>研</AvatarFallback>
                          </Avatar>
                          <AvatarGroupCount>+2</AvatarGroupCount>
                        </AvatarGroup>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-5">
                      <div className="flex gap-3">
                        <Avatar>
                          <AvatarFallback className="bg-primary/10 text-primary">研</AvatarFallback>
                          <AvatarBadge />
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            <p className="text-sm font-medium">研究 Agent</p>
                            <span className="text-[10px] text-muted-foreground">16:32</span>
                          </div>
                          <div className="mt-1 rounded-r-[8px] rounded-bl-[8px] bg-secondary px-3 py-2">
                            <p className="text-sm leading-[22px]">
                              已整理需求。
                              <span className="text-primary">@前端负责人</span> 请确认 Task
                              面板的筛选交互。
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-[8px] border bg-background p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="px-1 text-xs text-muted-foreground">回复群聊…</span>
                          <Button size="icon-sm" aria-label="发送消息">
                            <Send />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-none">
                    <CardHeader>
                      <CardTitle>Task 审核卡</CardTitle>
                      <CardDescription>先补全执行信息，再由人工审核后开始。</CardDescription>
                      <CardAction>
                        <Badge className="bg-warning/10 text-warning">待审核</Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <div>
                        <p className="text-sm font-medium">完成 Agent 上下文能力验证</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          验证群名、成员列表、实时消息和 @ 能力。
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 rounded-md bg-muted p-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground">执行者</p>
                          <p className="mt-1 text-xs font-medium">研究 Agent</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">审核人</p>
                          <p className="mt-1 text-xs font-medium">等待指定</p>
                        </div>
                      </div>
                    </CardContent>
                    <CardFooter className="justify-end gap-2">
                      <Button size="sm" variant="outline">
                        编辑计划
                      </Button>
                      <Button size="sm">审核并开始</Button>
                    </CardFooter>
                  </Card>
                </div>

                <div className="flex flex-col justify-between gap-4 border-t pt-8 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-sm font-medium">规范来源</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      飞书开放平台设计规范 · WorkTeam 工程映射
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {SOURCE_LINKS.map(([name, href]) => (
                      <a
                        key={name}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {name}
                        <ExternalLink className="size-3" />
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </ScrollArea>
  );
}
