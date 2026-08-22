import { RiInboxLine, RiSparkling2Line } from "@remixicon/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Input } from "@workspace/ui/components/input"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  AideLockup,
  AideMark,
  AideTile,
  AideWordmark,
} from "@workspace/ui/components/logo"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { StatusDot } from "@workspace/ui/components/status-dot"
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"

import { Sidebar } from "@/components/shell/sidebar"
import { SurfacePanel } from "@/components/shell/surface-panel"
import {
  ThreadHeader,
  ThreadMeta,
  ThreadTitle,
} from "@/components/shell/thread-header"
import { Composer } from "@/features/composer"
import { InstancesPanel } from "@/features/instances"
import { SessionActivity, SessionProvider } from "@/features/sessions"
import { RequestCard } from "@/features/transcript/request-card"
import { Transcript } from "@/features/transcript/transcript"
import { TypingIndicator } from "@/features/transcript/typing-indicator"
import {
  TURN_STATE_META,
  TurnStateBadge,
  type TurnDisplayState,
} from "@/features/transcript/turn-state"
import { ExecutionDisplay } from "@/features/transcript/execution-display"
import {
  mockCommandClient,
  mockExecution,
  mockInstances,
  mockMessages,
  mockReadClient,
  mockRecents,
  mockRequests,
  mockResolvedRequests,
  mockSubscribe,
} from "@/gallery/mock-data"
import { Frame, Row, Section, Swatch } from "@/gallery/section"
import { useTheme } from "@/components/theme-provider"

const NEUTRALS = [
  "--n0",
  "--n1",
  "--n2",
  "--n3",
  "--n4",
  "--n5",
  "--n6",
  "--n7",
  "--n8",
]
const ACCENTS = [
  "--accent-subtle",
  "--accent-dim",
  "--accent-base",
  "--accent-hi",
  "--accent-fg",
]
const STATUS = ["--ok", "--warn", "--danger-base"]
const DIFF = [
  "--diff-add-fg",
  "--diff-add-bg",
  "--diff-del-fg",
  "--diff-del-bg",
]
const RADII = [
  { name: "rounded-sm", className: "rounded-sm" },
  { name: "rounded-md", className: "rounded-md" },
  { name: "rounded-lg", className: "rounded-lg" },
  { name: "rounded-xl", className: "rounded-xl" },
  { name: "rounded-2xl", className: "rounded-2xl" },
]
const SURFACES = [
  { name: "Canvas", token: "--n0" },
  { name: "Raised", token: "--n1" },
  { name: "Floating", token: "--n2" },
  { name: "Active", token: "--n3" },
]
const TYPE_ROLES = [
  { className: "text-h1", label: "h1 · 40 / 600 / −0.038em" },
  { className: "text-h2", label: "h2 · 30 / 600 / −0.030em" },
  { className: "text-h3", label: "h3 · 20 / 600 / −0.020em" },
  { className: "text-body", label: "body · 15 / 400 / 1.62" },
  { className: "text-ui", label: "ui · 13 / 400" },
  { className: "text-small", label: "small · 12 / 400" },
  { className: "text-label uppercase", label: "label · 11 / 600 / +0.10em" },
  { className: "font-mono text-mono", label: "mono · 12 / 400 / 1.7" },
]
const TURN_STATES = Object.keys(TURN_STATE_META) as TurnDisplayState[]

export function Gallery() {
  const { theme, setTheme } = useTheme()

  return (
    <TooltipProvider>
      <div className="min-h-svh bg-background text-foreground">
        <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-border bg-background/85 px-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <AideLockup size={20} />
            <Badge tone="outline">design gallery</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-small text-muted-foreground">
              Press <Kbd>D</Kbd> to flip theme
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme}
            </Button>
          </div>
        </header>

        <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10">
          <div>
            <h1 className="text-h1">Components</h1>
            <p className="mt-2 max-w-2xl text-body text-muted-foreground">
              Every component rendered against fixtures from
              <span className="font-mono text-mono"> @workspace/contracts</span>
              . Swap <span className="font-mono text-mono">mock-data.ts</span>{" "}
              for the real clients to preview live data.
            </p>
          </div>

          <Section
            id="identity"
            title="Identity"
            note="Three discrete drawings, not one scaled asset (§8.2)."
          >
            <Row label="Mark — 16 / 20 / 32 / 48">
              <AideMark size={16} />
              <AideMark size={20} />
              <AideMark size={32} />
              <AideMark size={48} />
            </Row>
            <Row label="Tile / wordmark / lockup">
              <AideTile size={40} />
              <AideWordmark className="text-h3" />
              <AideLockup size={24} />
            </Row>
          </Section>

          <Section
            id="color"
            title="Color"
            note="One tinted neutral ramp, one accent hue, three status roles."
          >
            <Row label="Neutral ramp">
              {NEUTRALS.map((token) => (
                <Swatch key={token} name={token.slice(2)} value={token} />
              ))}
            </Row>
            <Row label="Accent">
              {ACCENTS.map((token) => (
                <Swatch key={token} name={token.slice(9)} value={token} />
              ))}
            </Row>
            <Row label="Status">
              {STATUS.map((token) => (
                <Swatch key={token} name={token.slice(2)} value={token} />
              ))}
            </Row>
            <Row label="Diff">
              {DIFF.map((token) => (
                <Swatch key={token} name={token.slice(7)} value={token} />
              ))}
            </Row>
          </Section>

          <Section
            id="typography"
            title="Typography"
            note="One typeface. Hierarchy comes from weight and tracking."
          >
            <div className="flex flex-col gap-4">
              {TYPE_ROLES.map((role) => (
                <div key={role.label} className="flex flex-col gap-1">
                  <span className="text-label text-muted-foreground uppercase">
                    {role.label}
                  </span>
                  <span className={role.className}>
                    One conversation. Any agent.
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="form"
            title="Form"
            note="Radius caps at 18px; elevation is a surface step, not a shadow."
          >
            <Row label="Radius">
              {RADII.map((radius) => (
                <div
                  key={radius.name}
                  className="flex flex-col items-center gap-1.5"
                >
                  <div
                    className={cn(
                      "size-16 border border-border bg-card",
                      radius.className
                    )}
                  />
                  <span className="text-small text-muted-foreground">
                    {radius.name}
                  </span>
                </div>
              ))}
            </Row>
            <Row label="Elevation">
              {SURFACES.map((surface) => (
                <div
                  key={surface.name}
                  className="flex size-24 flex-col items-center justify-center gap-1 rounded-lg border border-border"
                  style={{ background: `var(${surface.token})` }}
                >
                  <span className="text-ui font-medium">{surface.name}</span>
                  <span className="font-mono text-mono text-muted-foreground">
                    {surface.token}
                  </span>
                </div>
              ))}
            </Row>
          </Section>

          <Section id="buttons" title="Buttons">
            <Row label="Variants">
              <Button>Send</Button>
              <Button variant="outline">Open</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Delete</Button>
              <Button variant="link">Link</Button>
            </Row>
            <Row label="Sizes and states">
              <Button size="xs">xs</Button>
              <Button size="sm">sm</Button>
              <Button>default</Button>
              <Button size="lg">lg</Button>
              <Button size="icon" aria-label="Icon">
                <RiSparkling2Line aria-hidden="true" />
              </Button>
              <Button disabled>Disabled</Button>
            </Row>
          </Section>

          <Section id="inputs" title="Inputs">
            <div className="flex max-w-md flex-col gap-3">
              <Input placeholder="/path/to/project" aria-label="Project" />
              <Textarea
                rows={3}
                placeholder="Continue this session…"
                aria-label="Message"
              />
              <ModelSelectExample />
            </div>
            <Row label="Keys">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
              <Kbd>A</Kbd>
              <Separator orientation="vertical" className="h-5" />
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="outline">Hover me</Button>}
                />
                <TooltipContent>Tooltip surface</TooltipContent>
              </Tooltip>
            </Row>
          </Section>

          <Section
            id="state"
            title="Turn state"
            note="State is the only colour a transcript carries (§5)."
          >
            <Row label="Badges">
              {TURN_STATES.map((state) => (
                <TurnStateBadge key={state} state={state} />
              ))}
            </Row>
            <Row label="Dots">
              <StatusDot tone="idle" />
              <StatusDot tone="accent" pulse />
              <StatusDot tone="warn" />
              <StatusDot tone="ok" />
              <StatusDot tone="quiet" />
              <StatusDot tone="danger" />
            </Row>
            <Row label="Badges — tones">
              <Badge>neutral</Badge>
              <Badge tone="accent">accent</Badge>
              <Badge tone="ok">ok</Badge>
              <Badge tone="warn">warn</Badge>
              <Badge tone="danger">danger</Badge>
              <Badge tone="outline">outline</Badge>
            </Row>
          </Section>

          <Section id="empty" title="Empty states and tabs">
            <Frame label="Empty state">
              <EmptyState
                icon={<RiInboxLine />}
                title="No messages yet"
                description="Send the first message to start this session."
              />
            </Frame>
            <Frame label="Tabs">
              <Tabs defaultValue="files" className="p-3">
                <TabsList>
                  <TabsTab value="files">All files</TabsTab>
                  <TabsTab value="changes">Changes</TabsTab>
                  <TabsTab value="checks">Checks</TabsTab>
                </TabsList>
                <TabsPanel
                  value="files"
                  className="pt-3 text-ui text-muted-foreground"
                >
                  Workspace files land here.
                </TabsPanel>
                <TabsPanel
                  value="changes"
                  className="pt-3 text-ui text-muted-foreground"
                >
                  Diffs land here.
                </TabsPanel>
                <TabsPanel
                  value="checks"
                  className="pt-3 text-ui text-muted-foreground"
                >
                  Checks land here.
                </TabsPanel>
              </Tabs>
            </Frame>
          </Section>

          <Section
            id="transcript"
            title="Transcript"
            note="Rendered from message fixtures."
          >
            <Frame>
              <div className="p-4">
                <Transcript messages={mockMessages} />
              </div>
            </Frame>
            <Row label="Execution display">
              <ExecutionDisplay execution={mockExecution} />
            </Row>
            <Row label="Typing indicator">
              <TypingIndicator />
            </Row>
          </Section>

          <Section
            id="requests"
            title="Requests"
            note="Blocking requests get a persistent inline surface, never a toast."
          >
            <div className="flex flex-col gap-3">
              {mockRequests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  onResolve={() => {}}
                />
              ))}
            </div>
            <Row label="Resolved">
              <div className="flex w-full flex-col gap-2">
                {mockResolvedRequests.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    onResolve={() => {}}
                  />
                ))}
              </div>
            </Row>
          </Section>

          <Section
            id="composer"
            title="Composer"
            note="Controls are capability-driven; the resolved selection is shown as chips."
          >
            <Frame>
              <Composer
                execution={mockExecution}
                pending={false}
                onSend={() => {}}
              />
            </Frame>
            <Frame label="Without a selection">
              <Composer pending={false} onSend={() => {}} />
            </Frame>
          </Section>

          <Section id="instances" title="Instances">
            <InstancesPanel instances={mockInstances} />
          </Section>

          <Section
            id="shell"
            title="Shell"
            note="The three panes, rendered in isolation."
          >
            <Frame label="Thread header" className="bg-background">
              <ThreadHeader
                sidebarOpen
                onToggleSidebar={() => {}}
                panelOpen
                onTogglePanel={() => {}}
                title={<ThreadTitle>Wire the settings panel</ThreadTitle>}
                meta={<ThreadMeta>aide</ThreadMeta>}
              />
            </Frame>
            <div className="grid gap-4 lg:grid-cols-2">
              <Frame label="Sidebar" className="h-100 bg-sidebar">
                <div className="flex h-full w-68 flex-col">
                  <Sidebar
                    view="session"
                    activeSessionId="session_1"
                    recents={mockRecents}
                    onNewSession={() => {}}
                    onOpenSettings={() => {}}
                    onSelectSession={() => {}}
                  />
                </div>
              </Frame>
              <Frame label="Surface panel" className="h-100 bg-sidebar">
                <SurfacePanel
                  surface={null}
                  onOpenSurface={() => {}}
                  onCloseSurface={() => {}}
                  onClosePanel={() => {}}
                />
              </Frame>
            </div>
            <Frame
              label="Activity surface (fixture session)"
              className="bg-sidebar"
            >
              <SessionProvider
                sessionId="session_1"
                readClient={mockReadClient}
                commandClient={mockCommandClient}
                subscribe={mockSubscribe}
              >
                <div className="p-3">
                  <SessionActivity />
                </div>
              </SessionProvider>
            </Frame>
          </Section>
        </main>
      </div>
    </TooltipProvider>
  )
}

function ModelSelectExample() {
  const [value, setValue] = useState("claude-opus-5")

  return (
    <Select value={value} onValueChange={(next) => setValue(next as string)}>
      <SelectTrigger className="w-fit border border-input bg-[var(--n3)]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="claude-opus-5">Claude Opus 5</SelectItem>
        <SelectItem value="claude-sonnet-5">Claude Sonnet 5</SelectItem>
        <SelectItem value="gpt-5-codex">GPT-5 Codex</SelectItem>
      </SelectContent>
    </Select>
  )
}
