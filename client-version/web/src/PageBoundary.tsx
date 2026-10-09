import { Component, ErrorInfo, ReactNode } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";

/** Keep the workspace navigation available if a page fails to render. */
export default class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "Workspace page could not render",
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="panel error-state page-recovery" role="alert">
          <h2>This page couldn’t be displayed</h2>
          <p>Try again or return to the overview.</p>
          <div className="page-recovery-actions">
            <button
              className="primary"
              onClick={() => this.setState({ failed: false })}
            >
              <RefreshCw size={16} /> Try again
            </button>
            <Link className="button" to="/">
              Return to overview
            </Link>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
