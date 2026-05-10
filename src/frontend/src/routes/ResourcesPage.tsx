"use client"

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Clock,
  Play,
  RefreshCw,
  ShieldAlert,
  Server,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/useAuth"
import {
  StateBackend,
  ResourceScan,
  createStateBackend,
  listAwsCredentials,
  getResourceScanLogs,
  listTerraformPlanJobs,
  listResourceScans,
  listStateBackends,
  saveBackendPlan,
  startResourceScan,
  startTerraformPlanJob,
  ResourceScanLogEvent,
  TerraformPlanJob,
  AwsCredentialMetadata,
} from "@/services/resourcesService"

type ResultTab = "drift" | "policy" | "resources"
type CloudriftView = "overview" | "scan" | "builder" | "resources" | "policies" | "compliance" | "history"
type ScanService = "s3" | "ec2" | "iam"

type JsonRecord = Record<string, unknown>
type AlertKind = "drift" | "policy"

type ResourceRow = {
  key: string
  scan: ResourceScan
  resource: JsonRecord
  after: JsonRecord
  displayName: string
  subtitle: string
  resourceType: string
  status: "active" | "drifted" | "has alert"
  driftAlerts: unknown[]
  policyAlerts: unknown[]
  consoleUrl: string
  lastUpdated: string
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value)
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "-"
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function uniqueTexts(values: unknown[]): string[] {
  const seen = new Set<string>()
  values.forEach(value => {
    const current = text(value).trim()
    if (current) {
      seen.add(current)
    }
  })
  return [...seen]
}

function getLatestScansByBackend(scans: ResourceScan[]): ResourceScan[] {
  const latest = new Map<string, ResourceScan>()
  scans.forEach(scan => {
    const key = scan.backendId || scan.backendName || scan.scanId
    if (!latest.has(key)) {
      latest.set(key, scan)
    }
  })
  return [...latest.values()]
}

function getResourceAfter(resource: JsonRecord): JsonRecord {
  const change = asRecord(resource.change)
  return asRecord(change.after)
}

function getResourceAddress(resource: JsonRecord, after: JsonRecord): string {
  return (
    text(resource.address) ||
    text(resource.name) ||
    text(after.name) ||
    text(after.id) ||
    text(after.bucket) ||
    text(after.arn) ||
    "Resource"
  )
}

function getResourceName(resource: JsonRecord, after: JsonRecord): string {
  return (
    text(resource.name) ||
    text(after.tags && asRecord(after.tags).Name) ||
    text(after.bucket) ||
    text(after.id) ||
    getResourceAddress(resource, after)
  )
}

function getResourceCandidates(resource: JsonRecord, after: JsonRecord): string[] {
  return uniqueTexts([
    resource.address,
    resource.name,
    resource.type,
    after.id,
    after.name,
    after.bucket,
    after.arn,
    after.instance_id,
    asRecord(after.tags).Name,
  ]).map(value => value.toLowerCase())
}

function getAlertCandidates(alert: JsonRecord): string[] {
  return uniqueTexts([
    alert.resource_address,
    alert.resource_id,
    alert.resource_name,
    alert.resource_type,
    alert.address,
    alert.name,
  ]).map(value => value.toLowerCase())
}

function alertMatchesResource(alert: unknown, resource: JsonRecord, after: JsonRecord): boolean {
  const resourceCandidates = getResourceCandidates(resource, after)
  const alertCandidates = getAlertCandidates(asRecord(alert))
  if (!resourceCandidates.length || !alertCandidates.length) {
    return false
  }
  return alertCandidates.some(candidate =>
    resourceCandidates.some(resourceCandidate => {
      return (
        candidate === resourceCandidate ||
        candidate.includes(resourceCandidate) ||
        resourceCandidate.includes(candidate)
      )
    })
  )
}

function buildAwsConsoleUrl(scan: ResourceScan, resource: JsonRecord, after: JsonRecord): string {
  const region = scan.stateRegion || "us-east-1"
  const typeName = text(resource.type).toLowerCase()
  const id = text(after.id) || text(after.instance_id)
  const bucket = text(after.bucket) || text(resource.name)

  if (typeName === "aws_instance" && id.startsWith("i-")) {
    return `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#InstanceDetails:instanceId=${encodeURIComponent(id)}`
  }
  if (typeName === "aws_security_group" && id.startsWith("sg-")) {
    return `https://${region}.console.aws.amazon.com/ec2/home?region=${region}#SecurityGroup:groupId=${encodeURIComponent(id)}`
  }
  if (typeName === "aws_s3_bucket" && bucket) {
    return `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(bucket)}?region=${region}&bucketType=general`
  }
  if (typeName.startsWith("aws_iam_")) {
    return "https://us-east-1.console.aws.amazon.com/iam/home"
  }
  return ""
}

function buildResourceRows(scans: ResourceScan[]): ResourceRow[] {
  return getLatestScansByBackend(scans).flatMap(scan => {
    return scan.currentResources.map((item, index) => {
      const resource = asRecord(item)
      const after = getResourceAfter(resource)
      const driftAlerts = scan.driftAlerts.filter(alert => alertMatchesResource(alert, resource, after))
      const policyAlerts = scan.policyAlerts.filter(alert => alertMatchesResource(alert, resource, after))
      const resourceType = text(resource.type, "unknown")
      const displayName = getResourceName(resource, after)
      const address = getResourceAddress(resource, after)
      return {
        key: `${scan.scanId}-${address}-${index}`,
        scan,
        resource,
        after,
        displayName,
        subtitle: address === displayName ? text(after.arn) : address,
        resourceType,
        status: driftAlerts.length ? "drifted" : policyAlerts.length ? "has alert" : "active",
        driftAlerts,
        policyAlerts,
        consoleUrl: buildAwsConsoleUrl(scan, resource, after),
        lastUpdated: scan.updatedAt || scan.startedAt,
      }
    })
  })
}

function getAlertTitle(item: unknown, kind: AlertKind): string {
  const alert = asRecord(item)
  if (kind === "policy") {
    return text(alert.policy_name) || text(alert.policy_id) || "Policy finding"
  }
  return text(alert.resource_name) || text(alert.resource_id) || text(alert.resource_address) || "Drift finding"
}

function getAlertResource(item: unknown): string {
  const alert = asRecord(item)
  return text(alert.resource_address) || text(alert.resource_name) || text(alert.resource_id) || text(alert.resource_type) || "-"
}

function isCloudriftView(value: string | null): value is CloudriftView {
  return (
    value === "overview" ||
    value === "scan" ||
    value === "builder" ||
    value === "resources" ||
    value === "policies" ||
    value === "compliance" ||
    value === "history"
  )
}

function isScanService(value: string): value is ScanService {
  return value === "s3" || value === "ec2" || value === "iam"
}

function severityClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "border-red-200 bg-red-50 text-red-800"
    case "high":
      return "border-orange-200 bg-orange-50 text-orange-800"
    case "medium":
      return "border-amber-200 bg-amber-50 text-amber-800"
    case "low":
      return "border-sky-200 bg-sky-50 text-sky-800"
    default:
      return "border-slate-200 bg-slate-50 text-slate-700"
  }
}

const complianceFrameworks = [
  {
    key: "HIPAA",
    total: 22,
    policies: [
      "S3-001",
      "S3-003",
      "S3-004",
      "S3-005",
      "S3-006",
      "S3-007",
      "S3-008",
      "EC2-002",
      "RDS-001",
      "RDS-002",
      "RDS-005",
      "IAM-001",
      "CT-001",
      "CT-003",
      "KMS-001",
      "EBS-001",
      "EBS-002",
      "LAMBDA-002",
      "ELB-001",
      "ELB-002",
      "LOG-001",
      "LOG-002",
    ],
  },
  {
    key: "GDPR",
    total: 17,
    policies: [
      "S3-001",
      "S3-003",
      "S3-004",
      "S3-005",
      "S3-006",
      "S3-007",
      "S3-008",
      "EC2-002",
      "RDS-001",
      "RDS-002",
      "IAM-001",
      "CT-001",
      "EBS-001",
      "EBS-002",
      "ELB-002",
      "LOG-001",
      "LOG-002",
    ],
  },
  {
    key: "ISO 27001",
    total: 32,
    policies: [
      "S3-001",
      "S3-003",
      "S3-004",
      "S3-005",
      "S3-006",
      "S3-007",
      "S3-008",
      "S3-009",
      "EC2-001",
      "EC2-002",
      "EC2-003",
      "IAM-001",
      "IAM-002",
      "IAM-003",
      "VPC-001",
      "VPC-002",
    ],
  },
  {
    key: "PCI DSS",
    total: 34,
    policies: [
      "S3-001",
      "S3-002",
      "S3-003",
      "S3-004",
      "S3-005",
      "S3-006",
      "S3-007",
      "S3-008",
      "EC2-001",
      "EC2-002",
      "SG-001",
      "SG-002",
      "SG-003",
      "SG-004",
      "IAM-001",
      "IAM-002",
      "IAM-003",
      "SECRET-001",
      "SECRET-002",
    ],
  },
  {
    key: "SOC 2",
    total: 49,
    policies: [],
  },
]

function getPolicyId(item: unknown): string {
  return text(asRecord(item).policy_id)
}

function getSeverityCounts(items: unknown[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const severity = text(asRecord(item).severity, "info").toLowerCase()
    counts[severity] = (counts[severity] ?? 0) + 1
    return counts
  }, {})
}

function TabButton({
  value,
  active,
  onClick,
  children,
}: {
  value: CloudriftView
  active: CloudriftView
  onClick: (value: CloudriftView) => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant={active === value ? "default" : "outline"}
      onClick={() => onClick(value)}
      className="h-9"
    >
      {children}
    </Button>
  )
}

function MetricCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: number | string
  icon: ReactNode
  tone: string
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span className={`rounded-md p-2 ${tone}`}>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  )
}

function EmptyResults({ label }: { label: string }) {
  return <p className="p-4 text-sm text-slate-500">{label}</p>
}

function StatusBadge({ status }: { status: ResourceRow["status"] }) {
  const className =
    status === "drifted"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "has alert"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700"
  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${className}`}>
      {status}
    </span>
  )
}

function ResourcesTable({ rows }: { rows: ResourceRow[] }) {
  const [query, setQuery] = useState("")
  const filteredRows = rows.filter(row => {
    const haystack = [
      row.displayName,
      row.subtitle,
      row.resourceType,
      row.scan.backendName,
      row.scan.stateBucket,
      row.scan.stateKey,
      row.scan.service,
    ]
      .map(value => text(value).toLowerCase())
      .join(" ")
    return haystack.includes(query.trim().toLowerCase())
  })

  if (!rows.length) {
    return <EmptyResults label="No resources found in the latest state scans." />
  }

  return (
    <div>
      <div className="border-b p-4">
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search resources..."
          className="max-w-md"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Resource</th>
              <th className="px-4 py-3">State Backend</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Console Link</th>
              <th className="px-4 py-3">Last Updated</th>
              <th className="px-4 py-3 text-right">...</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredRows.map(row => (
              <tr key={row.key} className="align-top hover:bg-slate-50">
                <td className="px-4 py-4">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-4 py-4">
                  <p className="font-mono text-sm font-semibold text-slate-900">{row.displayName}</p>
                  <p className="mt-1 break-all text-xs text-slate-500">
                    {row.subtitle || row.resourceType}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <span className="inline-flex max-w-xs rounded-md border bg-white px-2 py-1 text-xs font-medium text-slate-700">
                    {row.scan.backendName || row.scan.backendId}
                  </span>
                  <p className="mt-1 break-all text-xs text-slate-500">
                    s3://{row.scan.stateBucket}/{row.scan.stateKey}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <p className="font-medium text-slate-800">AWS</p>
                  <p className="text-xs uppercase text-slate-500">{row.scan.service || row.resourceType}</p>
                </td>
                <td className="px-4 py-4">
                  {row.consoleUrl ? (
                    <a
                      href={row.consoleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-slate-900 underline underline-offset-4"
                    >
                      Open console
                    </a>
                  ) : (
                    <span className="text-slate-500">Unavailable</span>
                  )}
                </td>
                <td className="px-4 py-4 text-slate-600">{formatDate(row.lastUpdated)}</td>
                <td className="px-4 py-4 text-right">
                  <details className="group">
                    <summary className="cursor-pointer list-none text-slate-600 group-open:text-slate-950">
                      Details
                    </summary>
                    <div className="mt-3 w-[360px] rounded-md border bg-white p-3 text-left shadow-sm">
                      <p className="text-xs font-semibold uppercase text-slate-500">Attributes</p>
                      <div className="mt-2 grid gap-1">
                        {Object.entries(row.after)
                          .slice(0, 10)
                          .map(([key, value]) => (
                            <p key={key} className="break-all text-xs text-slate-600">
                              <span className="font-medium text-slate-800">{key}:</span>{" "}
                              {typeof value === "object" ? JSON.stringify(value) : text(value, "-")}
                            </p>
                          ))}
                      </div>
                      <p className="mt-3 text-xs text-slate-500">
                        {row.driftAlerts.length} drift alert, {row.policyAlerts.length} policy alert
                      </p>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filteredRows.length === 0 && <EmptyResults label="No resources match that search." />}
    </div>
  )
}

function AlertDetails({ item, kind }: { item: unknown; kind: AlertKind }) {
  if (kind === "drift") {
    const drift = asRecord(item)
    const diffs = asRecord(drift.diffs)
    const extra = asRecord(drift.extra_attributes)
    const rows = [...Object.entries(diffs), ...Object.entries(extra)]
    return (
      <div className="mt-3 rounded-md border bg-white p-3 text-xs text-slate-600">
        {drift.missing === true && <p className="mb-2 font-medium text-red-700">Resource is missing in AWS.</p>}
        {rows.length === 0 ? (
          <p>No attribute differences were reported.</p>
        ) : (
          <div className="grid gap-2">
            {rows.map(([key, value]) => (
              <p key={key} className="break-all">
                <span className="font-medium text-slate-800">{key}:</span>{" "}
                {Array.isArray(value) ? value.map(itemValue => text(itemValue, "-")).join(" -> ") : text(value, "-")}
              </p>
            ))}
          </div>
        )}
      </div>
    )
  }

  const policy = asRecord(item)
  return (
    <div className="mt-3 rounded-md border bg-white p-3 text-xs text-slate-600">
      {text(policy.message) && <p>{text(policy.message)}</p>}
      {text(policy.remediation) && (
        <p className="mt-2">
          <span className="font-medium text-slate-800">Remediation:</span> {text(policy.remediation)}
        </p>
      )}
      {asArray(policy.frameworks).length > 0 && (
        <p className="mt-2">
          <span className="font-medium text-slate-800">Frameworks:</span>{" "}
          {asArray(policy.frameworks).map(framework => text(framework)).join(", ")}
        </p>
      )}
    </div>
  )
}

function GroupedAlerts({ scans, kind }: { scans: ResourceScan[]; kind: AlertKind }) {
  const [query, setQuery] = useState("")
  const label = kind === "drift" ? "drift alerts" : "policy alerts"
  const groups = getLatestScansByBackend(scans)
    .map(scan => ({
      scan,
      items: kind === "drift" ? scan.driftAlerts : scan.policyAlerts,
    }))
    .filter(group => group.items.length > 0)

  if (!groups.length) {
    return <EmptyResults label={`No ${label} found in the latest state scans.`} />
  }

  return (
    <div>
      <div className="border-b p-4">
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={`Search ${label}...`}
          className="max-w-md"
        />
      </div>
      <div className="divide-y">
        {groups.map(group => {
          const filteredItems = group.items.filter(item => {
            const alert = asRecord(item)
            const haystack = [
              getAlertTitle(item, kind),
              getAlertResource(item),
              alert.policy_id,
              alert.severity,
              alert.message,
            ]
              .map(value => text(value).toLowerCase())
              .join(" ")
            return haystack.includes(query.trim().toLowerCase())
          })
          if (!filteredItems.length) {
            return null
          }
          return (
            <details key={group.scan.scanId} open className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <span className="font-semibold text-slate-900">
                    {group.scan.backendName || group.scan.backendId}
                  </span>
                  <span className="ml-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                    {filteredItems.length} active
                  </span>
                  <span className="ml-2 rounded-md border bg-white px-2 py-1 text-xs text-slate-600">
                    {group.items.length} total
                  </span>
                  <p className="mt-1 break-all text-xs text-slate-500">
                    s3://{group.scan.stateBucket}/{group.scan.stateKey}
                  </p>
                </div>
                <span className="text-sm text-slate-500 group-open:hidden">Expand</span>
                <span className="hidden text-sm text-slate-500 group-open:inline">Collapse</span>
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="border-b bg-white text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Resource</th>
                      <th className="px-4 py-3">Last Detected</th>
                      <th className="px-4 py-3">First Detected</th>
                      <th className="px-4 py-3">Severity</th>
                      <th className="px-4 py-3 text-right">...</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredItems.map((item, index) => {
                      const alert = asRecord(item)
                      return (
                        <tr key={`${group.scan.scanId}-${kind}-${index}`} className="align-top">
                          <td className="px-4 py-4">
                            <span className="inline-flex rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                              active
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-mono text-sm font-semibold text-slate-900">
                              {getAlertTitle(item, kind)}
                            </p>
                            <p className="mt-1 break-all text-xs text-slate-500">
                              {getAlertResource(item)}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {formatDate(group.scan.updatedAt || group.scan.startedAt)}
                          </td>
                          <td className="px-4 py-4 text-slate-600">{formatDate(group.scan.startedAt)}</td>
                          <td className="px-4 py-4">
                            <span className={`rounded-full border px-2 py-1 text-xs font-medium ${severityClass(text(alert.severity, kind === "drift" ? "warning" : "info"))}`}>
                              {text(alert.severity, kind === "drift" ? "warning" : "info")}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <details className="group/details">
                              <summary className="cursor-pointer list-none text-slate-600 group-open/details:text-slate-950">
                                Details
                              </summary>
                              <AlertDetails item={item} kind={kind} />
                            </details>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

function OverviewPanel({
  scans,
  selectedScan,
  totalResources,
  driftCount,
  policyCount,
}: {
  scans: ResourceScan[]
  selectedScan: ResourceScan | null
  totalResources: number
  driftCount: number
  policyCount: number
}) {
  const severityCounts = getSeverityCounts(selectedScan?.policyAlerts ?? [])
  const recentScans = scans.slice(0, 8).reverse()
  const maxDrift = Math.max(1, ...recentScans.map(scan => scan.driftAlerts.length))
  const complianceScores = buildComplianceScores(selectedScan)
  const averageScore = complianceScores.length
    ? Math.round(complianceScores.reduce((sum, item) => sum + item.score, 0) / complianceScores.length)
    : null

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Total Resources" value={totalResources} icon={<Server className="h-4 w-4" />} tone="bg-slate-100 text-slate-700" />
        <MetricCard label="Drifted Resources" value={driftCount} icon={<AlertTriangle className="h-4 w-4" />} tone="bg-orange-100 text-orange-700" />
        <MetricCard label="Policy Violations" value={policyCount} icon={<ShieldAlert className="h-4 w-4" />} tone="bg-red-100 text-red-700" />
        <MetricCard label="Compliance" value={averageScore === null ? "-" : `${averageScore}%`} icon={<CheckCircle2 className="h-4 w-4" />} tone="bg-emerald-100 text-emerald-700" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">Drift Trend</h2>
          <div className="mt-4 flex h-44 items-end gap-2">
            {recentScans.map(scan => (
              <div key={scan.scanId} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t bg-orange-400"
                  style={{ height: `${Math.max(8, (scan.driftAlerts.length / maxDrift) * 150)}px` }}
                />
                <span className="text-xs text-slate-500">{scan.driftAlerts.length}</span>
              </div>
            ))}
            {recentScans.length === 0 && <p className="text-sm text-slate-500">No scan history yet.</p>}
          </div>
        </section>

        <section className="rounded-lg border bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">Violations By Severity</h2>
          <div className="mt-4 space-y-3">
            {["critical", "high", "medium", "low", "info"].map(severity => {
              const count = severityCounts[severity] ?? 0
              const width = policyCount ? Math.max(4, (count / policyCount) * 100) : 0
              return (
                <div key={severity}>
                  <div className="flex justify-between text-sm">
                    <span className="capitalize text-slate-700">{severity}</span>
                    <span className="text-slate-500">{count}</span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-slate-100">
                    <div className="h-2 rounded bg-slate-800" style={{ width: `${width}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <CompliancePanel selectedScan={selectedScan} compact />
    </div>
  )
}

function buildComplianceScores(selectedScan: ResourceScan | null) {
  if (!selectedScan) {
    return []
  }
  const failed = new Set((selectedScan?.policyAlerts ?? []).map(getPolicyId).filter(Boolean))
  return complianceFrameworks.map(framework => {
    const matchedFailures =
      framework.policies.length > 0
        ? framework.policies.filter(policyId => failed.has(policyId)).length
        : failed.size
    const total = framework.total
    const passed = Math.max(0, total - matchedFailures)
    return {
      ...framework,
      failed: matchedFailures,
      passed,
      score: total ? Math.round((passed / total) * 100) : 100,
    }
  })
}

function CompliancePanel({
  selectedScan,
  compact = false,
}: {
  selectedScan: ResourceScan | null
  compact?: boolean
}) {
  const scores = buildComplianceScores(selectedScan)
  if (!scores.length) {
    return (
      <section className="rounded-lg border bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Compliance Frameworks</h2>
        <p className="mt-3 text-sm text-slate-500">Run a Cloudrift scan to populate compliance results.</p>
      </section>
    )
  }
  return (
    <section className="rounded-lg border bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">Compliance Frameworks</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {scores.map(score => (
          <div key={score.key} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-900">{score.key}</p>
              <span
                className={`rounded-full px-2 py-1 text-xs font-medium ${
                  score.score >= 80
                    ? "bg-emerald-50 text-emerald-700"
                    : score.score >= 50
                      ? "bg-amber-50 text-amber-700"
                      : "bg-red-50 text-red-700"
                }`}
              >
                {score.score}%
              </span>
            </div>
            <div className="mt-3 h-2 rounded bg-slate-100">
              <div className="h-2 rounded bg-emerald-500" style={{ width: `${score.score}%` }} />
            </div>
            {!compact && (
              <p className="mt-3 text-sm text-slate-500">
                {score.passed} passed, {score.failed} failed of {score.total}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function HistoryPanel({ scans, onSelect }: { scans: ResourceScan[]; onSelect: (scanId: string) => void }) {
  if (!scans.length) {
    return <EmptyResults label="No scan history found." />
  }

  return (
    <section className="rounded-lg border bg-white">
      <div className="border-b p-5">
        <h2 className="text-base font-semibold text-slate-900">Scan History</h2>
      </div>
      <div className="divide-y">
        {scans.map(scan => (
          <button
            key={scan.scanId}
            type="button"
            onClick={() => onSelect(scan.scanId)}
            className="grid w-full gap-3 p-4 text-left hover:bg-slate-50 md:grid-cols-[1fr_120px_120px_120px]"
          >
            <div>
              <p className="font-medium text-slate-900">{scan.backendName || scan.backendId}</p>
              <p className="break-all text-sm text-slate-500">
                {scan.stateBucket}/{scan.stateKey}
              </p>
            </div>
            <span className="text-sm text-slate-600">{scan.status}</span>
            <span className="text-sm text-orange-700">{scan.driftAlerts.length} drift</span>
            <span className="text-sm text-red-700">{scan.policyAlerts.length} policies</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function ResourcesPage() {
  const auth = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [backends, setBackends] = useState<StateBackend[]>([])
  const [scans, setScans] = useState<ResourceScan[]>([])
  const [selectedBackendId, setSelectedBackendId] = useState("")
  const [selectedScanId, setSelectedScanId] = useState("")
  const [activeTab, setActiveTab] = useState<ResultTab>("drift")
  const [activeViewState, setActiveViewState] = useState<CloudriftView>(() => {
    const view = searchParams.get("view")
    return isCloudriftView(view) ? view : "overview"
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isSavingBackend, setIsSavingBackend] = useState(false)
  const [isSavingPlan, setIsSavingPlan] = useState(false)
  const [isStartingScan, setIsStartingScan] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanLogs, setScanLogs] = useState<ResourceScanLogEvent[]>([])
  const [scanLogsToken, setScanLogsToken] = useState<string | null>(null)
  const [scanLogsLocation, setScanLogsLocation] = useState({ logGroupName: "", logStreamName: "" })
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [terraformJobs, setTerraformJobs] = useState<TerraformPlanJob[]>([])
  const [credentials, setCredentials] = useState<AwsCredentialMetadata[]>([])
  const [activeCredentialId, setActiveCredentialId] = useState("")
  const [terraformFiles, setTerraformFiles] = useState<File[]>([])
  const [isStartingTerraformJob, setIsStartingTerraformJob] = useState(false)
  const [planText, setPlanText] = useState("")
  const [backendForm, setBackendForm] = useState({
    name: "",
    bucket: "",
    key: "",
    region: "us-east-2",
    service: "s3" as ScanService,
    credentialId: "",
  })

  const [terraformForm, setTerraformForm] = useState({
    name: "",
    bucket: "",
    key: "",
    region: "us-east-2",
    service: "ec2" as ScanService,
    credentialId: "",
  })

  const activeView = activeViewState

  const setActiveView = useCallback(
    (view: CloudriftView) => {
      setActiveViewState(view)
      setSearchParams({ view })
    },
    [setSearchParams]
  )

  useEffect(() => {
    const view = searchParams.get("view")
    if (isCloudriftView(view) && view !== activeViewState) {
      setActiveViewState(view)
    }
  }, [activeViewState, searchParams])

  const selectedScan = useMemo(() => {
    return scans.find(scan => scan.scanId === selectedScanId) ?? scans[0] ?? null
  }, [scans, selectedScanId])

  const selectedBackend = useMemo(() => {
    return backends.find(backend => backend.backendId === selectedBackendId) ?? backends[0] ?? null
  }, [backends, selectedBackendId])

  const latestScans = useMemo(() => getLatestScansByBackend(scans), [scans])
  const allResourceRows = useMemo(() => buildResourceRows(scans), [scans])
  const allDriftCount = latestScans.reduce((sum, scan) => sum + scan.driftAlerts.length, 0)
  const allPolicyCount = latestScans.reduce((sum, scan) => sum + scan.policyAlerts.length, 0)
  const rawResult = asRecord(selectedScan?.rawResult)
  const totalResources =
    allResourceRows.length ||
    numberValue(rawResult.total_resources, selectedScan?.currentResources.length ?? 0)
  const driftCount = allDriftCount || numberValue(rawResult.drift_count, selectedScan?.driftAlerts.length ?? 0)
  const policyCount = allPolicyCount || (selectedScan?.policyAlerts.length ?? 0)
  const durationMs = numberValue(rawResult.scan_duration_ms, 0)

  const refresh = useCallback(async () => {
    const idToken = auth.user?.id_token
    if (!idToken) return
    setIsLoading(true)
    setError(null)
    try {
      const [loadedBackends, loadedScans, loadedCredentials] = await Promise.all([
        listStateBackends(idToken),
        listResourceScans(idToken),
        listAwsCredentials(idToken).catch(() => ({ credentials: [], activeCredentialId: "" })),
      ])
      const loadedTerraformJobs = await listTerraformPlanJobs(idToken).catch(() => [])
      setBackends(loadedBackends)
      setScans(loadedScans)
      setCredentials(loadedCredentials.credentials)
      const defaultCredentialId =
        loadedCredentials.activeCredentialId || loadedCredentials.credentials[0]?.credentialId || ""
      setActiveCredentialId(defaultCredentialId)
      setTerraformJobs(loadedTerraformJobs)
      setSelectedBackendId(current => current || loadedBackends[0]?.backendId || "")
      setSelectedScanId(current => current || loadedScans[0]?.scanId || "")
      const credential = loadedCredentials.credentials.find(item => item.credentialId === defaultCredentialId) ?? loadedCredentials.credentials[0]
      if (credential?.region) {
        setBackendForm(current => ({
          ...current,
          region: current.region === "us-east-2" ? credential.region || current.region : current.region,
          credentialId: current.credentialId || credential.credentialId || "",
        }))
        setTerraformForm(current => ({
          ...current,
          region: current.region === "us-east-2" ? credential.region || current.region : current.region,
          credentialId: current.credentialId || credential.credentialId || "",
        }))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load resources")
    } finally {
      setIsLoading(false)
    }
  }, [auth.user?.id_token])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!auth.user?.id_token || (selectedScan?.status !== "IN_PROGRESS" && selectedScan?.status !== "RUNNING")) return

    const intervalId = window.setInterval(() => {
      refresh()
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [auth.user?.id_token, refresh, selectedScan?.status])

  useEffect(() => {
    if (!auth.user?.id_token || !terraformJobs.some(job => job.status === "RUNNING")) return

    const intervalId = window.setInterval(() => {
      refresh()
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [auth.user?.id_token, refresh, terraformJobs])

  const refreshScanLogs = useCallback(
    async (mode: "reset" | "append" = "append") => {
      const idToken = auth.user?.id_token
      if (!idToken || !selectedScan?.scanId) return
      const token = mode === "append" ? scanLogsToken : null
      setIsLoadingLogs(true)
      try {
        const logs = await getResourceScanLogs(selectedScan.scanId, idToken, token)
        setScanLogs(current => (mode === "append" ? [...current, ...logs.events] : logs.events))
        setScanLogsToken(logs.nextForwardToken ?? null)
        setScanLogsLocation({
          logGroupName: logs.logGroupName ?? "",
          logStreamName: logs.logStreamName ?? "",
        })
      } catch (logError) {
        setError(logError instanceof Error ? logError.message : "Failed to load Cloudrift logs")
      } finally {
        setIsLoadingLogs(false)
      }
    },
    [auth.user?.id_token, scanLogsToken, selectedScan?.scanId]
  )

  useEffect(() => {
    setScanLogs([])
    setScanLogsToken(null)
    setScanLogsLocation({ logGroupName: "", logStreamName: "" })
    const idToken = auth.user?.id_token
    const scanId = selectedScan?.scanId
    if (!idToken || !scanId) return

    setIsLoadingLogs(true)
    getResourceScanLogs(scanId, idToken)
      .then(logs => {
        setScanLogs(logs.events)
        setScanLogsToken(logs.nextForwardToken ?? null)
        setScanLogsLocation({
          logGroupName: logs.logGroupName ?? "",
          logStreamName: logs.logStreamName ?? "",
        })
      })
      .catch(logError => {
        setError(logError instanceof Error ? logError.message : "Failed to load Cloudrift logs")
      })
      .finally(() => setIsLoadingLogs(false))
  }, [auth.user?.id_token, selectedScan?.scanId])

  useEffect(() => {
    if (!selectedScan?.scanId || (selectedScan.status !== "IN_PROGRESS" && selectedScan.status !== "RUNNING")) return

    const intervalId = window.setInterval(() => {
      void refreshScanLogs("append")
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [refreshScanLogs, selectedScan?.scanId, selectedScan?.status])

  async function handleCreateBackend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const idToken = auth.user?.id_token
    if (!idToken) {
      setError("Sign in before adding a state backend")
      return
    }

    setIsSavingBackend(true)
    setError(null)
    setMessage(null)
    try {
      const backend = await createStateBackend(backendForm, idToken)
      setBackends(current => [backend, ...current])
      setSelectedBackendId(backend.backendId)
      setBackendForm(current => ({ ...current, name: "", bucket: "", key: "" }))
      setMessage("State backend saved")
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save state backend")
    } finally {
      setIsSavingBackend(false)
    }
  }

  async function handleSavePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const idToken = auth.user?.id_token
    if (!idToken || !selectedBackendId) {
      setError("Select a state backend before saving a plan")
      return
    }

    let plan: Record<string, unknown>
    try {
      const parsed = JSON.parse(planText) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Plan JSON must be an object")
      }
      plan = parsed as Record<string, unknown>
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Plan JSON is invalid")
      return
    }

    setIsSavingPlan(true)
    setError(null)
    setMessage(null)
    try {
      const backend = await saveBackendPlan(selectedBackendId, plan, idToken)
      setBackends(current =>
        current.map(item => (item.backendId === backend.backendId ? backend : item))
      )
      setMessage("Terraform plan JSON saved to S3")
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save Terraform plan")
    } finally {
      setIsSavingPlan(false)
    }
  }

  async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer()
    let binary = ""
    const bytes = new Uint8Array(buffer)
    for (let index = 0; index < bytes.byteLength; index += 1) {
      binary += String.fromCharCode(bytes[index])
    }
    return window.btoa(binary)
  }

  async function handleStartTerraformPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const idToken = auth.user?.id_token
    if (!idToken) {
      setError("Sign in before running Terraform")
      return
    }
    if (!terraformFiles.length) {
      setError("Select Terraform source files before starting the plan job")
      return
    }

    setIsStartingTerraformJob(true)
    setError(null)
    setMessage(null)
    try {
      const files = await Promise.all(
        terraformFiles.map(async file => ({
          name: file.name,
          content: await fileToBase64(file),
        }))
      )
      const result = await startTerraformPlanJob({ ...terraformForm, files }, idToken)
      setTerraformJobs(current => [result.job, ...current])
      setBackends(current => [result.backend, ...current])
      setSelectedBackendId(result.backend.backendId)
      setMessage("Terraform plan job started")
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Failed to start Terraform plan")
    } finally {
      setIsStartingTerraformJob(false)
    }
  }

  async function handleStartScan() {
    const idToken = auth.user?.id_token
    if (!idToken || !selectedBackendId) return

    setIsStartingScan(true)
    setError(null)
    setMessage(null)
    try {
      const scan = await startResourceScan(selectedBackendId, idToken)
      setScans(current => [scan, ...current])
      setSelectedScanId(scan.scanId)
      setMessage("Drift check started")
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Failed to start drift check")
    } finally {
      setIsStartingScan(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <h1 className="text-xl font-semibold text-slate-900">Resources</h1>
        <div className="flex gap-2">
          <Button onClick={refresh} variant="outline" disabled={isLoading} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reload
          </Button>
        </div>
      </header>

      <nav className="border-b bg-white px-6 py-3">
        <div className="flex flex-wrap gap-2">
          <TabButton value="overview" active={activeView} onClick={setActiveView}>
            Dashboard
          </TabButton>
          <TabButton value="scan" active={activeView} onClick={setActiveView}>
            Scan
          </TabButton>
          <TabButton value="builder" active={activeView} onClick={setActiveView}>
            Resource Builder
          </TabButton>
          <TabButton value="resources" active={activeView} onClick={setActiveView}>
            Resources
          </TabButton>
          <TabButton value="policies" active={activeView} onClick={setActiveView}>
            Policies
          </TabButton>
          <TabButton value="compliance" active={activeView} onClick={setActiveView}>
            Compliance
          </TabButton>
          <TabButton value="history" active={activeView} onClick={setActiveView}>
            History
          </TabButton>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-4 p-6 lg:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-4">
          {message && <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <form className="rounded-lg border bg-white p-5" onSubmit={handleCreateBackend}>
            <div className="flex items-center gap-3">
              <Cloud className="h-5 w-5 text-slate-800" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">S3 State Backend</h2>
                <p className="text-sm text-slate-500">Register Terraform state stored in S3.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Name
                <Input
                  value={backendForm.name}
                  onChange={event =>
                    setBackendForm(current => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Bucket
                <Input
                  value={backendForm.bucket}
                  onChange={event =>
                    setBackendForm(current => ({ ...current, bucket: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Key
                <Input
                  value={backendForm.key}
                  onChange={event =>
                    setBackendForm(current => ({ ...current, key: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Region
                <Input
                  value={backendForm.region}
                  onChange={event =>
                    setBackendForm(current => ({ ...current, region: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Cloudrift Service
                <select
                  className="h-9 rounded-md border bg-white px-3 text-sm"
                  value={backendForm.service}
                  onChange={event => {
                    const service = isScanService(event.target.value) ? event.target.value : "s3"
                    setBackendForm(current => ({ ...current, service }))
                  }}
                >
                  <option value="s3">S3</option>
                  <option value="ec2">EC2</option>
                  <option value="iam">IAM</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                AWS Credential
                <select
                  className="h-9 rounded-md border bg-white px-3 text-sm"
                  value={backendForm.credentialId || activeCredentialId}
                  onChange={event => {
                    setActiveCredentialId(event.target.value)
                    setBackendForm(current => ({ ...current, credentialId: event.target.value }))
                  }}
                >
                  {credentials.length === 0 ? (
                    <option value="">No saved credentials</option>
                  ) : (
                    credentials.map(credential => (
                      <option key={credential.credentialId} value={credential.credentialId}>
                        {credential.name || credential.accountId} ({credential.region})
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>
            <Button
              type="submit"
              className="mt-4 w-full"
              disabled={isSavingBackend || credentials.length === 0}
            >
              {isSavingBackend ? "Saving" : "Add State Backend"}
            </Button>
          </form>

          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center gap-3">
              <Server className="h-5 w-5 text-slate-800" />
              <h2 className="text-base font-semibold text-slate-900">Backends</h2>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {backends.length === 0 && (
                <p className="text-sm text-slate-500">No state backends configured.</p>
              )}
              {backends.map(backend => (
                <button
                  key={backend.backendId}
                  type="button"
                  onClick={() => setSelectedBackendId(backend.backendId)}
                  className={`rounded-md border p-3 text-left text-sm transition ${
                    selectedBackendId === backend.backendId
                      ? "border-slate-900 bg-slate-100"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className="block font-medium text-slate-900">{backend.name}</span>
                  <span className="block break-all text-slate-500">
                    s3://{backend.bucket}/{backend.key}
                  </span>
                  <span className="block text-slate-500">
                    {backend.region} · {(backend.service || "s3").toUpperCase()}
                  </span>
                  {backend.credentialName && (
                    <span className="block text-slate-500">Credential: {backend.credentialName}</span>
                  )}
                  {backend.planUpdatedAt && (
                    <span className="block text-slate-500">Plan saved {backend.planUpdatedAt}</span>
                  )}
                </button>
              ))}
            </div>
            <Button
              type="button"
              onClick={handleStartScan}
              disabled={!selectedBackendId || isStartingScan}
              className="mt-4 w-full gap-2"
            >
              <Play className="h-4 w-4" />
              {isStartingScan ? "Starting" : "Run Drift Check"}
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {activeView === "overview" && (
            <OverviewPanel
              scans={scans}
              selectedScan={selectedScan}
              totalResources={totalResources}
              driftCount={driftCount}
              policyCount={policyCount}
            />
          )}

          {activeView === "builder" && (
            <div className="flex flex-col gap-4">
              <section className="rounded-lg border bg-white">
                <div className="border-b p-5">
                  <h2 className="text-base font-semibold text-slate-900">Terraform Source Builder</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Upload Terraform source files, run Terraform in CodeBuild, and save the generated plan JSON to S3.
                  </p>
                </div>
                <form className="grid gap-4 p-5" onSubmit={handleStartTerraformPlan}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                      Backend Name
                      <Input
                        value={terraformForm.name}
                        onChange={event => setTerraformForm(current => ({ ...current, name: event.target.value }))}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                      Cloudrift Service
                      <select
                        className="h-9 rounded-md border bg-white px-3 text-sm"
                        value={terraformForm.service}
                        onChange={event => {
                          const service = isScanService(event.target.value) ? event.target.value : "ec2"
                          setTerraformForm(current => ({ ...current, service }))
                        }}
                      >
                        <option value="s3">S3</option>
                        <option value="ec2">EC2</option>
                        <option value="iam">IAM</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                      Output Bucket
                      <Input
                        value={terraformForm.bucket}
                        onChange={event => setTerraformForm(current => ({ ...current, bucket: event.target.value }))}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                      Output Key
                      <Input
                        value={terraformForm.key}
                        onChange={event => setTerraformForm(current => ({ ...current, key: event.target.value }))}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                      Region
                      <Input
                        value={terraformForm.region}
                        onChange={event => setTerraformForm(current => ({ ...current, region: event.target.value }))}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                      AWS Credential
                      <select
                        className="h-9 rounded-md border bg-white px-3 text-sm"
                        value={terraformForm.credentialId || activeCredentialId}
                        onChange={event => {
                          setActiveCredentialId(event.target.value)
                          setTerraformForm(current => ({ ...current, credentialId: event.target.value }))
                        }}
                      >
                        {credentials.length === 0 ? (
                          <option value="">No saved credentials</option>
                        ) : (
                          credentials.map(credential => (
                            <option key={credential.credentialId} value={credential.credentialId}>
                              {credential.name || credential.accountId} ({credential.region})
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                      Terraform Files
                      <Input
                        type="file"
                        multiple
                        accept=".tf,.tfvars"
                        onChange={event => setTerraformFiles(Array.from(event.target.files ?? []))}
                      />
                    </label>
                  </div>
                  {terraformFiles.length > 0 && (
                    <div className="rounded-md border bg-slate-50 p-3 text-sm text-slate-600">
                      {terraformFiles.map(file => (
                        <p key={file.name}>{file.name}</p>
                      ))}
                    </div>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      isStartingTerraformJob ||
                      !terraformForm.name ||
                      !terraformForm.bucket ||
                      !terraformForm.key ||
                      credentials.length === 0 ||
                      !terraformFiles.length
                    }
                  >
                    {isStartingTerraformJob ? "Starting" : "Run Terraform Plan"}
                  </Button>
                </form>
              </section>

              <section className="rounded-lg border bg-white">
                <div className="border-b p-5">
                  <h2 className="text-base font-semibold text-slate-900">Terraform Plan Jobs</h2>
                </div>
                <div className="divide-y">
                  {terraformJobs.length === 0 && <EmptyResults label="No Terraform plan jobs found." />}
                  {terraformJobs.map(job => (
                    <div key={job.jobId} className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_120px_120px]">
                      <div>
                        <p className="font-medium text-slate-900">{job.backendName || job.backendId}</p>
                        <p className="break-all text-slate-500">
                          s3://{job.bucket}/{job.key}
                        </p>
                        {job.error && <p className="mt-1 text-red-700">{job.error}</p>}
                      </div>
                      <span className="text-slate-600">{job.status}</span>
                      <span className="text-slate-600">{job.phase || "-"}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border bg-white">
                <div className="border-b p-5">
                  <h2 className="text-base font-semibold text-slate-900">Plan JSON Upload</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Save Terraform plan JSON to the selected S3 backend and scan it with Cloudrift.
                  </p>
                </div>
                <form className="grid gap-4 p-5" onSubmit={handleSavePlan}>
                  <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                    Selected Backend
                    <select
                      className="h-9 rounded-md border bg-white px-3 text-sm"
                      value={selectedBackendId}
                      onChange={event => setSelectedBackendId(event.target.value)}
                    >
                      {backends.map(backend => (
                        <option key={backend.backendId} value={backend.backendId}>
                          {backend.name} · {(backend.service || "s3").toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedBackend && (
                    <div className="rounded-md border bg-slate-50 p-3 text-sm text-slate-600">
                      <p className="break-all">
                        s3://{selectedBackend.bucket}/{selectedBackend.key}
                      </p>
                      <p>{selectedBackend.region}</p>
                      {selectedBackend.planUpdatedAt && <p>Plan saved {selectedBackend.planUpdatedAt}</p>}
                    </div>
                  )}

                  <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                    Terraform Plan JSON
                    <Textarea
                      value={planText}
                      onChange={event => setPlanText(event.target.value)}
                      className="min-h-80 font-mono text-xs"
                      spellCheck={false}
                    />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={!selectedBackendId || !planText.trim() || isSavingPlan}>
                      {isSavingPlan ? "Saving" : "Save Plan To S3 Backend"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleStartScan}
                      disabled={!selectedBackendId || isStartingScan}
                      className="gap-2"
                    >
                      <Play className="h-4 w-4" />
                      {isStartingScan ? "Starting" : "Run Cloudrift Scan"}
                    </Button>
                  </div>
                </form>
              </section>
            </div>
          )}

          {activeView === "resources" && (
            <section className="rounded-lg border bg-white">
              <div className="border-b p-5">
                <h2 className="text-base font-semibold text-slate-900">Resource Explorer</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Latest Cloudrift scan resources across every registered state backend.
                </p>
              </div>
              <ResourcesTable rows={allResourceRows} />
            </section>
          )}

          {activeView === "policies" && (
            <section className="rounded-lg border bg-white">
              <div className="border-b p-5">
                <h2 className="text-base font-semibold text-slate-900">Policy Dashboard</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Policy alerts grouped by the state backend that produced them.
                </p>
              </div>
              <GroupedAlerts scans={scans} kind="policy" />
            </section>
          )}

          {activeView === "compliance" && <CompliancePanel selectedScan={selectedScan} />}

          {activeView === "history" && (
            <HistoryPanel
              scans={scans}
              onSelect={scanId => {
                setSelectedScanId(scanId)
                setActiveView("scan")
              }}
            />
          )}

          {activeView === "scan" && (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard
                  label="Resources"
                  value={totalResources}
                  icon={<Server className="h-4 w-4" />}
                  tone="bg-slate-100 text-slate-700"
                />
                <MetricCard
                  label="Drift"
                  value={driftCount}
                  icon={<AlertTriangle className="h-4 w-4" />}
                  tone="bg-orange-100 text-orange-700"
                />
                <MetricCard
                  label="Policy Alerts"
                  value={policyCount}
                  icon={<ShieldAlert className="h-4 w-4" />}
                  tone="bg-red-100 text-red-700"
                />
                <MetricCard
                  label="Duration"
                  value={durationMs ? `${durationMs}ms` : "-"}
                  icon={<Clock className="h-4 w-4" />}
                  tone="bg-sky-100 text-sky-700"
                />
              </div>

              <div className="rounded-lg border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Cloudrift Results</h2>
              <p className="text-sm text-slate-500">
                {selectedScan
                  ? `${selectedScan.status} - ${selectedScan.backendName || selectedScan.backendId}`
                  : "Run a drift check to populate this view."}
              </p>
              {selectedScan?.status === "SUCCEEDED" && (
                <p className="mt-2 flex items-center gap-2 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Result persisted from Cloudrift JSON output
                </p>
              )}
              {selectedScan?.error && (
                <p className="mt-2 text-sm text-red-700">{selectedScan.error}</p>
              )}
            </div>
            <select
              className="h-9 rounded-md border bg-white px-3 text-sm"
              value={selectedScanId}
              onChange={event => setSelectedScanId(event.target.value)}
            >
              {scans.map(scan => (
                <option key={scan.scanId} value={scan.scanId}>
                  {scan.status} - {scan.startedAt}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 border-b p-3">
            <Button
              type="button"
              variant={activeTab === "drift" ? "default" : "outline"}
              onClick={() => setActiveTab("drift")}
              className="gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              Drift Alert
            </Button>
            <Button
              type="button"
              variant={activeTab === "policy" ? "default" : "outline"}
              onClick={() => setActiveTab("policy")}
              className="gap-2"
            >
              <ShieldAlert className="h-4 w-4" />
              Policy Alert
            </Button>
            <Button
              type="button"
              variant={activeTab === "resources" ? "default" : "outline"}
              onClick={() => setActiveTab("resources")}
              className="gap-2"
            >
              <Server className="h-4 w-4" />
              Current Resources
            </Button>
          </div>

          {activeTab === "drift" && <GroupedAlerts scans={scans} kind="drift" />}
          {activeTab === "policy" && <GroupedAlerts scans={scans} kind="policy" />}
          {activeTab === "resources" && <ResourcesTable rows={allResourceRows} />}
              </div>

              <section className="rounded-lg border bg-white">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Cloudrift CodeBuild Logs</h2>
                    {scanLogsLocation.logGroupName && (
                      <p className="mt-1 break-all text-xs text-slate-500">
                        {scanLogsLocation.logGroupName}
                        {scanLogsLocation.logStreamName ? ` / ${scanLogsLocation.logStreamName}` : ""}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => refreshScanLogs("reset")}
                    disabled={!selectedScan?.scanId || isLoadingLogs}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {isLoadingLogs ? "Loading" : "Reload Logs"}
                  </Button>
                </div>
                <div className="max-h-96 overflow-auto bg-slate-950 p-4">
                  {scanLogs.length === 0 ? (
                    <p className="font-mono text-xs text-slate-400">
                      No CloudWatch log events are available yet.
                    </p>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-100">
                      {scanLogs
                        .map(event => {
                          const prefix = event.timestamp
                            ? new Date(event.timestamp).toISOString()
                            : ""
                          return `${prefix} ${event.message}`.trim()
                        })
                        .join("\n")}
                    </pre>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
