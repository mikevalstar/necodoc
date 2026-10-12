import { type Role, type SignInChannel, signInChannels } from "@necodoc/shared";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
  AnalyticsHeader,
  bucketDays,
  logDays,
  RangeControls,
  rangeSearchFields,
  toRange,
} from "@/components/analytics";
import {
  ChartCard,
  countsByBucket,
  criticalColor,
  formatCount,
  InlineBar,
  type SeriesDef,
  SimpleTable,
  StatTile,
  slot,
  TimeChart,
  timeTable,
} from "@/components/charts";
import { ErrorAlert } from "@/components/form";
import { Page } from "@/components/page";
import { api, ok } from "@/lib/api";
import { dayjs } from "@/lib/date";

// Spec: docs/features/analytics-dashboards.md (Auth & access). Sign-ins come from the audit log;
// rows link into it with matching filters.

const searchSchema = z.object(rangeSearchFields);
type Search = z.infer<typeof searchSchema>;

const accessQuery = (search: Search) => {
  const query = toRange(search);
  return queryOptions({
    queryKey: ["analytics", "access", query],
    queryFn: async () => (await ok(api.analytics.access.$get({ query }))).json(),
    placeholderData: keepPreviousData,
  });
};

const channelLabels = {
  password: "Password",
  oidc: "OIDC",
  saml: "SAML",
  trusted_header: "Trusted header",
  sso: "SSO (provider removed)",
} satisfies Record<SignInChannel, string>;
const channelSlots = { password: 1, oidc: 2, saml: 3, trusted_header: 4, sso: 5 } as const;
const channelSeries = signInChannels.map((key) => ({
  key,
  label: channelLabels[key],
  color: slot(channelSlots[key]),
})) satisfies SeriesDef<SignInChannel>[];

const failedSeries = [{ key: "failed", label: "Failed sign-ins", color: criticalColor }] as const;
const activeSeries = [{ key: "users", label: "Active users", color: slot(1) }] as const;
const newSeries = [{ key: "users", label: "New users", color: slot(1) }] as const;

const roleLabels = {
  admin: "Admin",
  publisher: "Publisher",
  reviewer: "Reviewer",
  editor: "Editor",
  viewer: "Viewer",
  none: "No role (pending)",
} satisfies Record<Role | "none", string>;

export const Route = createFileRoute("/_app/admin/analytics/access")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!context.me.user.roles.includes("admin")) throw redirect({ to: "/" });
  },
  component: AccessAnalytics,
});

const ago = (at: string | null) => (at ? dayjs(at).fromNow() : "—");

function AccessAnalytics() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const result = useQuery(accessQuery(search));
  const range = toRange(search);
  const days = logDays(range.from, range.to);
  const data = result.data;
  const fetching = result.isPlaceholderData;

  const signIns =
    data &&
    countsByBucket(
      data.bucket,
      data.buckets,
      channelSeries,
      data.signIns,
      (row) => row.channel,
      (row) => row.ok,
    );
  const failed =
    data &&
    countsByBucket(
      data.bucket,
      data.buckets,
      failedSeries,
      data.signIns,
      () => "failed",
      (row) => row.failed,
    );
  const active =
    data &&
    countsByBucket(
      data.bucket,
      data.buckets,
      activeSeries,
      data.active.series,
      () => "users",
      (row) => row.users,
    );
  const newUsers =
    data &&
    countsByBucket(
      data.bucket,
      data.buckets,
      newSeries,
      data.newUsers,
      () => "users",
      (row) => row.count,
    );
  const totalOk = data?.providers.reduce((sum, p) => sum + p.ok, 0) ?? 0;
  const totalFailed = data?.providers.reduce((sum, p) => sum + p.failed, 0) ?? 0;
  const openAudit = (
    action: "auth.signed_in" | "auth.sign_in_failed",
    at: { from: string; to: string },
  ) => navigate({ to: "/admin/audit", search: { action, ...at } });

  return (
    <Page>
      <AnalyticsHeader current="access" />
      <div className="flex flex-wrap items-end gap-3">
        <RangeControls search={search} onChange={(next) => navigate({ search: next })} />
        <Link
          to="/admin/audit"
          search={{ action: "auth.signed_in", ...days }}
          className="ml-auto self-center text-sm text-muted-foreground hover:underline"
        >
          Open sign-ins in the audit log
        </Link>
      </div>
      <ErrorAlert error={result.error} />

      {data && signIns && failed && active && newUsers && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Sign-ins"
              value={formatCount(totalOk)}
              hint={`${formatCount(totalFailed)} failed`}
            />
            <StatTile
              label="Active users in range"
              value={formatCount(data.active.inRange)}
              hint={`New: ${formatCount(data.newUsers.reduce((sum, row) => sum + row.count, 0))}`}
            />
            <StatTile
              label="DAU / WAU / MAU"
              value={`${data.active.daily} / ${data.active.weekly} / ${data.active.monthly}`}
              hint={`Ending ${dayjs(range.to).subtract(1, "minute").format("MMM D")}`}
            />
            <StatTile
              label="API keys used in range"
              value={data.keys.filter((key) => key.generations > 0).length}
              hint={`${data.keys.length} keys shown`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Sign-ins by method"
              description="Successful sign-ins. Click a column for those entries in the audit log."
              fetching={fetching}
              table={timeTable(signIns, true)}
              csv={{ filename: "sign-ins-by-method", ...timeTable(signIns, true) }}
            >
              <TimeChart
                data={signIns}
                kind="stacked"
                label="Successful sign-ins over time by method"
                onSelect={(t) => openAudit("auth.signed_in", bucketDays(data.bucket, t))}
              />
            </ChartCard>
            <ChartCard
              title="Failed sign-ins"
              fetching={fetching}
              table={timeTable(failed, false)}
              csv={{ filename: "failed-sign-ins", ...timeTable(failed, false) }}
            >
              <TimeChart
                data={failed}
                kind="stacked"
                label="Failed sign-ins over time"
                onSelect={(t) => openAudit("auth.sign_in_failed", bucketDays(data.bucket, t))}
              />
            </ChartCard>
            <ChartCard
              title={`Active users per ${data.bucket}`}
              description="Signed in, changed something, or generated without an API key."
              fetching={fetching}
              table={timeTable(active, false)}
              csv={{ filename: "active-users", ...timeTable(active, false) }}
            >
              <TimeChart data={active} kind="line" label="Active users over time" />
            </ChartCard>
            <ChartCard
              title={`New users per ${data.bucket}`}
              description="Accounts created, service accounts excluded."
              fetching={fetching}
              table={timeTable(newUsers, false)}
              csv={{ filename: "new-users", ...timeTable(newUsers, false) }}
            >
              <TimeChart data={newUsers} kind="stacked" label="New users over time" />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Providers"
              fetching={fetching}
              csv={{
                filename: "sign-in-providers",
                header: ["Method", "Provider", "Sign-ins", "Failed"],
                rows: data.providers.map((p) => [
                  channelLabels[p.channel],
                  p.provider,
                  p.ok,
                  p.failed,
                ]),
              }}
            >
              <SimpleTable
                header={["Method · provider", "Sign-ins", "Failed"]}
                rows={data.providers.map((p) => [
                  `${channelLabels[p.channel]}${p.provider ? ` · ${p.provider}` : ""}`,
                  <InlineBar
                    key="bar"
                    value={p.ok}
                    max={Math.max(...data.providers.map((x) => x.ok))}
                  />,
                  p.failed,
                ])}
              />
            </ChartCard>
            <ChartCard
              title="Failure reasons"
              fetching={fetching}
              csv={{
                filename: "sign-in-failure-reasons",
                header: ["Reason", "Count"],
                rows: data.failures.reasons.map((r) => [r.reason, r.count]),
              }}
            >
              <SimpleTable
                header={["Reason", "Count"]}
                rows={data.failures.reasons.map((r) => [
                  r.reason ?? "unknown",
                  <InlineBar
                    key="bar"
                    value={r.count}
                    max={data.failures.reasons[0]?.count ?? 0}
                  />,
                ])}
              />
            </ChartCard>
            <ChartCard
              title="Failed sign-ins by email"
              fetching={fetching}
              csv={{
                filename: "failed-sign-ins-by-email",
                header: ["Email", "Count", "Last"],
                rows: data.failures.emails.map((r) => [r.email, r.count, r.lastAt]),
              }}
            >
              <SimpleTable
                header={["Email", "Failures", "Last"]}
                rows={data.failures.emails.map((r) => [
                  r.email ? (
                    <Link
                      key="link"
                      to="/admin/audit"
                      search={{ action: "auth.sign_in_failed", q: r.email, ...days }}
                      className="hover:underline"
                    >
                      {r.email}
                    </Link>
                  ) : (
                    "(none given)"
                  ),
                  <InlineBar key="bar" value={r.count} max={data.failures.emails[0]?.count ?? 0} />,
                  ago(r.lastAt),
                ])}
              />
            </ChartCard>
            <ChartCard
              title="Failed sign-ins by IP"
              fetching={fetching}
              csv={{
                filename: "failed-sign-ins-by-ip",
                header: ["IP", "Count", "Last"],
                rows: data.failures.ips.map((r) => [r.ip, r.count, r.lastAt]),
              }}
            >
              <SimpleTable
                header={["IP", "Failures", "Last"]}
                rows={data.failures.ips.map((r) => [
                  r.ip ? (
                    <Link
                      key="link"
                      to="/admin/audit"
                      search={{ action: "auth.sign_in_failed", q: r.ip, ...days }}
                      className="font-mono text-xs hover:underline"
                    >
                      {r.ip}
                    </Link>
                  ) : (
                    "unknown"
                  ),
                  <InlineBar key="bar" value={r.count} max={data.failures.ips[0]?.count ?? 0} />,
                  ago(r.lastAt),
                ])}
              />
            </ChartCard>
          </div>

          <ChartCard
            title="Roles"
            description="Current users, not the range. A user with several roles counts in each."
            fetching={fetching}
            csv={{
              filename: "roles",
              header: ["Role", "Users"],
              rows: data.roles.map((r) => [roleLabels[r.role], r.users]),
            }}
          >
            <SimpleTable
              header={["Role", "Users"]}
              rows={data.roles.map((r) => [
                <Link key="link" to="/admin/users" className="hover:underline">
                  {roleLabels[r.role]}
                </Link>,
                <InlineBar
                  key="bar"
                  value={r.users}
                  max={Math.max(...data.roles.map((x) => x.users))}
                />,
              ])}
            />
          </ChartCard>

          <ChartCard
            title="API keys"
            description="Requests and last use are lifetime; generations and errors are in the range."
            fetching={fetching}
            csv={{
              filename: "api-keys",
              header: [
                "Key",
                "Owner",
                "Service account",
                "Requests",
                "Last used",
                "Generations",
                "Errors",
                "Revoked",
              ],
              rows: data.keys.map((k) => [
                k.name ?? k.id,
                k.ownerName,
                k.serviceAccount,
                k.requests,
                k.lastUsedAt,
                k.generations,
                k.errors,
                k.revokedAt,
              ]),
            }}
          >
            <SimpleTable
              header={["Key · owner", "Requests", "Last used", "Generations", "Errors"]}
              rows={data.keys.map((k) => [
                <Link
                  key="link"
                  to="/generations"
                  search={{ apiKeyId: k.id, ...days }}
                  className="hover:underline"
                >
                  {k.name ?? k.id}{" "}
                  <span className="text-muted-foreground">
                    · {k.ownerName}
                    {k.revokedAt ? " · revoked" : ""}
                  </span>
                </Link>,
                <InlineBar
                  key="bar"
                  value={k.requests}
                  max={data.keys[0]?.requests ?? 0}
                  label={formatCount(k.requests)}
                />,
                ago(k.lastUsedAt),
                k.generations,
                k.errors,
              ])}
            />
          </ChartCard>

          <ChartCard
            title="Service accounts"
            fetching={fetching}
            csv={{
              filename: "service-accounts",
              header: ["Account", "Contact", "Disabled", "Keys", "Last used", "Generations"],
              rows: data.serviceAccounts.map((a) => [
                a.name,
                a.contact,
                a.disabled,
                a.keys,
                a.lastUsedAt,
                a.generations,
              ]),
            }}
          >
            <SimpleTable
              header={["Account", "Keys", "Last used", "Generations"]}
              empty="No service accounts."
              rows={data.serviceAccounts.map((a) => [
                <Link
                  key="link"
                  to="/admin/service-accounts/$id"
                  params={{ id: a.userId }}
                  className="hover:underline"
                >
                  {a.name}
                  {a.disabled && <span className="text-muted-foreground"> · disabled</span>}
                </Link>,
                a.keys,
                ago(a.lastUsedAt),
                a.generations,
              ])}
            />
          </ChartCard>
        </>
      )}
    </Page>
  );
}
