import { useContext, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Context } from "./App";
import { api, post, Row } from "./api";
import { salesAgentRole } from "./BranchScope";
import { Drawer, ErrorState, Loading } from "./components";
const grantLabels: Record<string, string> = {
  read: "View workspace records",
  "settings.write": "Accounts and branch setup",
  "task.write": "Targets and team operations",
  "incentive.write": "Manage commission amounts and rules",
  "inventory.write": "Manage branch stock",
  "inventory.self": "Request and return own stock",
  "compliance.write": "Backend review and SR reconciliation",
  "ekyc.write": "Capture customer and order screenshots",
  "support.write": "Respond to support requests",
  "report.read": "Export authorized reports",
  "audit.read": "View audit history",
  "device.ping": "Device connectivity status",
  "shift.write": "Record work shifts",
  "location.self": "Start own work-location tracking",
  "location.read": "View authorized work locations",
  "location.manage": "Configure work boundaries",
  "call.tele.read": "View tele-verification queue",
  "call.tele.write": "Record tele-verification calls",
  "call.welcome.read": "View welcome-call queue",
  "call.welcome.write": "Record welcome calls",
};
export default function AccountAccess({ onClose }: { onClose: () => void }) {
  const { user, notify } = useContext(Context),
    cache = useQueryClient();
  const query = useQuery<Row>({
    queryKey: ["account-access", user.id],
    queryFn: () => api("/organization/access"),
    enabled: user.role === "Administrator",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [chosen, setChosen] = useState<string[]>([]),
    [reason, setReason] = useState("");
  const [account, setAccount] = useState<Row | null>(null);
  const branches = useQuery<Row[]>({
    queryKey: ["branches"],
    queryFn: () => api("/resources/branches"),
  });
  return (
    <Drawer title="Accounts & role access" onClose={() => !busy && onClose()}>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={query.refetch} />
      ) : (
        <>
          <h3>Create backend / management login</h3>
          <p>
            Sales agents and team leaders use their own branch-linked creation
            forms. Admin handles daily operations; Super admin controls accounts
            and permissions.
          </p>
          <form
            className="sales-form compact"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const form = event.currentTarget,
                values = Object.fromEntries(new FormData(form));
              setBusy(true);
              setError("");
              try {
                await post("/organization/access/accounts", {
                  ...values,
                  branch_id: values.branch_id || null,
                });
                form.reset();
                await query.refetch();
                notify("Account created");
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : "Could not create account",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Name
              <input
                name="name"
                minLength={2}
                maxLength={120}
                required
                disabled={busy}
              />
            </label>
            <label>
              Sign-in email
              <input
                type="email"
                name="email"
                maxLength={180}
                required
                disabled={busy}
              />
            </label>
            <label>
              Role
              <select name="role_id" required disabled={busy} defaultValue="">
                <option value="" disabled>
                  Choose the staff role
                </option>
                {query
                  .data!.roles.filter(
                    (r: Row) =>
                      !["Field Agent", "Team Leader"].includes(r.name),
                  )
                  .map((r: Row) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Branch
              <select name="branch_id" disabled={busy}>
                <option value="">
                  All authorized branches / no branch assignment
                </option>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={72}
                required
                disabled={busy}
              />
              <small>Share privately with the staff member.</small>
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Create account"}
            </button>
          </form>
          <h3>Current accounts</h3>
          <div className="sales-table-wrap">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Login</th>
                  <th>Role</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {query.data!.accounts.map((p: Row) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.email}</td>
                    <td>{salesAgentRole(p.role)}</td>
                    <td>
                      {!["Field Agent", "Team Leader"].includes(p.role) && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setAccount(p);
                            setError("");
                          }}
                        >
                          Edit account
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {account && (
            <form
              key={account.id}
              className="sales-form compact"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                const values = Object.fromEntries(
                  new FormData(event.currentTarget),
                );
                try {
                  await api(`/organization/access/accounts/${account.id}`, {
                    method: "PUT",
                    body: JSON.stringify({
                      ...values,
                      branch_id: values.branch_id || null,
                      expected: {
                        name: account.name,
                        email: account.email,
                        role_id: account.role_id,
                        branch_id: account.branch_id,
                      },
                    }),
                  });
                  setAccount(null);
                  await cache.invalidateQueries();
                  notify("Account updated; staff must sign in again");
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Could not update account",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h3 className="wide">Edit {account.name}</h3>
              <label>
                Name
                <input
                  name="name"
                  defaultValue={account.name}
                  required
                  minLength={2}
                  maxLength={120}
                  disabled={busy}
                />
              </label>
              <label>
                Sign-in email
                <input
                  name="email"
                  type="email"
                  defaultValue={account.email}
                  required
                  maxLength={180}
                  disabled={busy}
                />
              </label>
              <label>
                Role
                <select
                  name="role_id"
                  defaultValue={account.role_id}
                  disabled={busy}
                >
                  {query
                    .data!.roles.filter(
                      (r: Row) =>
                        !["Field Agent", "Team Leader"].includes(r.name),
                    )
                    .map((r: Row) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Branch
                <select
                  name="branch_id"
                  defaultValue={account.branch_id || ""}
                  disabled={busy}
                >
                  <option value="">No branch assignment</option>
                  {branches.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                New password · optional
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  maxLength={72}
                  disabled={busy}
                />
                <small>Leave empty to keep the current password.</small>
              </label>
              <label>
                Reason
                <input
                  name="reason"
                  required
                  minLength={5}
                  maxLength={300}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAccount(null)}
              >
                Cancel edit
              </button>
              <button className="primary" disabled={busy}>
                Save account
              </button>
            </form>
          )}
          <h3>Role access</h3>
          <p>
            Permissions can be restricted within each role’s maximum access.
            Changes require staff to sign in again.
          </p>
          <div className="account-role-options">
            {query.data!.roles.map((r: Row) => (
              <button
                type="button"
                key={r.id}
                disabled={busy}
                onClick={() => {
                  setEditing(r);
                  setChosen(r.permissions);
                  setReason("");
                  setError("");
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          {editing && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api("/organization/access/roles/" + editing.id, {
                    method: "PUT",
                    body: JSON.stringify({
                      permissions: chosen,
                      expected: editing.permissions,
                      reason,
                    }),
                  });
                  setEditing(null);
                  await cache.invalidateQueries();
                  notify("Role access updated; staff must sign in again");
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Access update failed",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h4>{editing.label}</h4>
              <div className="leader-choice-list">
                {editing.allowed.map((grant: string) => (
                  <label key={grant} className="leader-choice">
                    <input
                      type="checkbox"
                      checked={chosen.includes(grant)}
                      disabled={busy}
                      onChange={(event) =>
                        setChosen(
                          event.target.checked
                            ? [...chosen, grant]
                            : chosen.filter((item) => item !== grant),
                        )
                      }
                    />
                    <span>
                      {grantLabels[grant] || grant.replaceAll(".", " · ")}
                    </span>
                  </label>
                ))}
              </div>
              <label>
                Reason
                <input
                  value={reason}
                  required
                  minLength={5}
                  maxLength={300}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Save role access
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="sales-error">
              {error}
            </p>
          )}
        </>
      )}
    </Drawer>
  );
}
