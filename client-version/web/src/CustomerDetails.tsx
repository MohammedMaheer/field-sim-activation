import { Link } from "react-router-dom";
import { Row } from "./api";
import { DataTable, DetailList } from "./components";
import ActivationStatus from "./ActivationStatus";
import { productNames } from "./ProductTargets";

export default function CustomerDetails({ customer }: { customer: Row }) {
  const details = customer.details || {};
  const history: Row[] = customer.sales || customer.history || [];
  return (
    <div className="customer-record">
      <h2>{customer.name}</h2>
      <DetailList
        data={{
          customer: customer.name,
          arabic_name:
            details.arabic_name || customer.arabic_name || "Not recorded",
          phone_number: details.msisdn || customer.mobile,
          alternate_number: details.alternate_number || "Not recorded",
          account_number: details.account_number || "Not recorded",
          document: customer.document,
          document_type:
            (
              { EMIRATES_ID: "Emirates ID", PASSPORT: "Passport" } as Record<
                string,
                string
              >
            )[details.document_type] ||
            details.document_type ||
            "Not recorded",
          nationality: customer.nationality || "Not recorded",
          date_of_birth:
            details.date_of_birth || details.birth_date || "Not recorded",
          issue_date: details.issue_date || "Not recorded",
          expiry_date: details.expiry_date || "Not recorded",
          sex: details.sex || details.gender || "Not recorded",
          sr_number: customer.sr_number || "Not recorded",
          latest_request_id: customer.request_id || "Not recorded",
          branch: customer.branch || "Not recorded",
          sales_agent: customer.agent || "Not recorded",
        }}
      />
      <h3>Sales & activity history · {history.length}</h3>
      <DataTable
        rows={history}
        columns={[
          {
            key: "request_id",
            label: "Order / request",
            render: (row) => (
              <Link to={`/sales?selected=${encodeURIComponent(row.id)}`}>
                {row.request_id || "Not recorded"}
              </Link>
            ),
          },
          {
            key: "sr_number",
            label: "SR number",
            render: (row) =>
              row.details?.sr_number || row.sr_number || "Not recorded",
          },
          {
            key: "order_type",
            label: "Product / plan",
            render: (row) => (
              <>
                <b>
                  {productNames[row.order_type] ||
                    row.order_type ||
                    "Not recorded"}
                </b>
                <small className="cell-sub">
                  {row.plan_name || "Not recorded"}
                </small>
              </>
            ),
          },
          {
            key: "created_at",
            label: "Recorded",
            render: (row) =>
              new Date(row.created_at).toLocaleDateString("en-GB"),
          },
          {
            key: "status",
            label: "Activation / SR",
            render: (row) => <ActivationStatus row={row} />,
          },
          {
            key: "tele_verification",
            label: "Calls",
            render: (row) => (
              <>
                <span>Tele: {row.tele_verification || "Not recorded"}</span>
                <small className="cell-sub">
                  Welcome: {row.welcome_call || "Not recorded"}
                </small>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
