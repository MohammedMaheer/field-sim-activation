import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Row } from "./api";

const BranchContext = createContext({
  branch: "",
  setBranch: (_: string) => {},
  branches: [] as Row[],
  branchesLoading: false,
  branchesError: null as unknown,
});

/** Shared across routes; selections never carry into another signed-in account. */
export function BranchScope({
  user,
  children,
}: {
  user: Row;
  children: ReactNode;
}) {
  const storageKey = `relay.branch.${user.id}`;
  const [branch, select] = useState(
    () => sessionStorage.getItem(storageKey) || "",
  );
  const allowed = canFilterBranches(user);
  const query = useQuery<Row[]>({
    queryKey: ["branches", "scope", user.id],
    queryFn: () => api("/resources/branches"),
    enabled: allowed,
  });
  const branches = query.data || [];
  const setBranch = (id: string) => {
    if (id && !branches.some((item) => item.id === id)) return;
    select(id);
    if (id) sessionStorage.setItem(storageKey, id);
    else sessionStorage.removeItem(storageKey);
  };
  useEffect(() => {
    if (
      (!allowed || query.data) &&
      branch &&
      !branches.some((item) => item.id === branch)
    ) {
      select("");
      sessionStorage.removeItem(storageKey);
    }
  }, [allowed, query.data, branch, storageKey]);
  return (
    <BranchContext.Provider
      value={{
        branch,
        setBranch,
        branches,
        branchesLoading: allowed && query.isPending,
        branchesError: query.error,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export const useBranchScope = () => useContext(BranchContext);
export function clearBranchScope(userId: string) {
  sessionStorage.removeItem(`relay.branch.${userId}`);
}

export function salesAgentRole(role: string) {
  return role === "Field Agent" ? "Sales agent" : role;
}

export function canFilterBranches(user: Row) {
  return ["read", "call.tele.read", "call.welcome.read"].some((permission) =>
    user.permissions?.includes(permission),
  );
}
