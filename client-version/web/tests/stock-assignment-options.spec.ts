import {test, expect} from "@playwright/test";
import {authenticate} from "./session";

test("new stock assignments and targets exclude exited agents", async ({page, request}) => {
  await authenticate(page);
  const login = await request.post("/api/auth/login", {data: {email:"admin@relay.demo", password:process.env.DEMO_PASSWORD, native:true}});
  expect(login.ok()).toBeTruthy();
  const headers = {Authorization:`Bearer ${(await login.json()).access_token}`};
  const sims = await (await request.get("/api/resources/inventory", {headers})).json();
  const sim = sims.find((row:any) => !["ACTIVATED", "RESERVED", "RETIRED"].includes(row.status));
  expect(sim).toBeTruthy();
  const candidates = [
    {id:"exited-choice", name:"Exited stock candidate", employee_id:"EXIT-001", employment_status:"EXITED", branch_id:"test-branch", branch:"Test branch"},
    {id:"active-choice", name:"Active stock candidate", employee_id:"ACTIVE-001", employment_status:"ACTIVE", branch_id:"test-branch", branch:"Test branch"},
  ];
  await page.route("**/api/resources/agents*", route => route.fulfill({json:candidates}));
  const checkChoices = async (label:string) => {
    const select = page.locator("form").getByRole("combobox", {name:label, exact:true});
    await expect(select).toBeVisible();
    await expect(select.locator("option[value='active-choice']")).toHaveCount(1);
    await expect(select.locator("option[value='exited-choice']")).toHaveCount(0);
  };
  await page.goto("/administration?section=inventory");
  await page.getByRole("button", {name:"Add SIM", exact:true}).click();
  await checkChoices("Agent");
  await page.goto(`/inventory?selected=${sim.id}`);
  await checkChoices("Assign to agent");
  await page.route("**/api/field-assets", route => route.fulfill({json:[{
    id:"assignment-stock", category:"UNIFORM", label:"Test supply", serial:"Not recorded", quantity:2,
    branch_id:"test-branch", branch:"Test branch", agent_id:null, agent:"Unassigned", status:"AVAILABLE",
  }]}));
  await page.goto("/equipment");
  await page.getByRole("button", {name:"Move / update", exact:true}).click();
  await checkChoices("Assigned agent");
  await page.getByRole("button", {name:"Cancel", exact:true}).click();
  await page.getByRole("button", {name:"Issue stock", exact:true}).click();
  await checkChoices("Agent");
  await page.goto("/sales");
  await page.getByRole("navigation", {name:"Sales sections"}).getByRole("button", {name:"Targets",exact:true}).click();
  await checkChoices("Agent");
});
