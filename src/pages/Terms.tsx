export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-1 w-32 rounded-full gradient-phoenix" />
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Phoenix Flow Terms
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Store limits, commercial use, refunds, fraud prevention, and support boundaries.
          </p>
        </div>

        <div className="glass-panel rounded-3xl border border-border/50 p-6 sm:p-8 lg:p-10">
          <div className="space-y-8">
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">Personal Use Only</h2>
              <p className="leading-7 text-muted-foreground">
                Phoenix Flow subscriptions are intended for personal use by the
                account owner to manage their own Shopify and Etsy stores.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">Prohibited Commercial Use</h2>
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li>Provide product optimization services to clients</li>
                <li>Manage stores on behalf of other business owners</li>
                <li>Resell or white-label our service to third parties</li>
                <li>Use one account to serve multiple business clients</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">Store Ownership Requirement</h2>
              <p className="leading-7 text-muted-foreground">
                All stores linked to your account must be owned or directly operated
                by you. You must have legal authority to modify products in all
                connected stores.
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-xl font-semibold text-[hsl(var(--phoenix-warning))]">
                Store Limits &amp; Trial Frequency
              </h2>
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li>Free: 1 store maximum</li>
                <li>Basic: 1 store maximum</li>
                <li>Pro: 3 stores maximum</li>
                <li>Premium: 10 stores maximum</li>
              </ul>
              <div className="space-y-3">
                <h3 className="text-base font-semibold">6-Month Trial Limit</h3>
                <p className="leading-7 text-muted-foreground">
                  The Free tier and its associated 5 product optimizations are limited to
                  <strong className="ml-1 text-foreground">
                    one (1) trial period every six (6) months
                  </strong>{" "}
                  per user and per unique Shopify/Etsy store URL.
                </p>
                <p className="leading-7 text-muted-foreground">
                  If you have used a free trial within the last six months, you are ineligible
                  for further free optimizations for that store, even if the application was uninstalled and reinstalled.
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">Agency / Commercial Use</h2>
              <p className="leading-7 text-muted-foreground">
                If you need to manage client stores or provide optimization services
                professionally, contact us for Agency Plan pricing at{" "}
                <a
                  className="font-medium text-primary transition hover:text-accent"
                  href="mailto:karen.brandmeyer@ironphoenixflow.com"
                >
                  karen.brandmeyer@ironphoenixflow.com
                </a>.
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-xl font-semibold text-primary">Refund Policy</h2>
              <div className="space-y-3">
                <h3 className="text-base font-semibold">14-Day Money-Back Guarantee (Limited Use)</h3>
                <p className="leading-7 text-muted-foreground">
                  You may request a full refund within 14 days of purchase if you have
                  used <strong className="text-foreground">fewer than 10 product optimizations</strong>.
                </p>
                <p className="leading-7 text-muted-foreground">
                  <strong className="text-foreground">After 10 products, all sales are final.</strong>{" "}
                  Our Free tier provides 5 product optimizations to test Phoenix Flow risk-free before purchasing.
                </p>
              </div>
              <div className="space-y-3">
                <h3 className="text-base font-semibold">Why This Limit?</h3>
                <p className="leading-7 text-muted-foreground">
                  Our AI models incur real-time API costs for each optimization performed. This usage cap
                  prevents abuse by users who optimize their entire inventory and then request
                  a refund to avoid payment.
                </p>
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-xl font-semibold uppercase tracking-wide text-accent">
                Chargeback &amp; Fraud Policy
              </h2>
              <p className="leading-7 text-muted-foreground">
                By using Phoenix Flow, you acknowledge that our digital services are
                rendered immediately upon product optimization.
              </p>
              <div className="rounded-2xl border border-accent/30 bg-accent/10 p-5">
                <ul className="list-disc space-y-3 pl-5 text-muted-foreground">
                  <li>
                    <strong className="text-foreground">Fraudulent Chargebacks:</strong>{" "}
                    Attempting to dispute a valid charge for a service you have already utilized
                    (e.g., optimizing 10+ products) is considered &quot;Friendly Fraud&quot; and a violation of these terms.
                  </li>
                  <li>
                    <strong className="text-foreground">Evidence Submission:</strong>{" "}
                    In the event of a chargeback, Go Hard Gaming D LLC will submit your account usage logs,
                    optimized product history, and IP address records to your bank as evidence of service fulfillment.
                  </li>
                  <li>
                    <strong className="text-foreground">Recovery Costs:</strong>{" "}
                    We reserve the right to report unauthorized chargebacks to specialized fraud databases and pursue
                    collection of the original debt plus any associated bank dispute fees.
                  </li>
                </ul>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">Disclaimer of Guarantees</h2>
              <p className="leading-7 text-muted-foreground">
                The services provided by Go Hard Gaming D LLC are intended to assist with marketing efforts, including the generation of keywords and other content. While we strive to provide tools that can enhance your store&apos;s visibility, we do not guarantee any specific outcomes, including but not limited to increased sales, revenue, or profits. Your success is dependent on factors outside of our control, such as your advertising strategy, pricing, and market competition.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">Marketplace Scanner</h2>
              <p className="leading-7 text-muted-foreground">
                Our Marketplace Scanner is designed to identify potential &quot;red flags&quot; relevant to Google&apos;s policies. Go Hard Gaming D LLC is not affiliated with, endorsed by, or an authorized agent of Google. The scanner&apos;s findings are for informational purposes only and do not constitute an official assessment. It remains your responsibility to ensure all content is compliant with applicable laws.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-[hsl(var(--phoenix-warning))]">
                Violation Consequences
              </h2>
              <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                <li>Immediate account suspension</li>
                <li>Permanent ban from future use</li>
                <li>Forfeiture of all refund eligibility</li>
                <li>Subject to legal action for terms violations</li>
              </ol>
            </section>

            <section className="space-y-4">
              <h2 className="text-xl font-semibold text-primary">Agency Elite Support Policy</h2>
              <div className="space-y-3">
                <h3 className="text-base font-semibold">Support Scope</h3>
                <p className="leading-7 text-muted-foreground">
                  Agency Elite support is limited to technical assistance with using
                  the Phoenix Flow platform.
                </p>
                <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                  <li>Bug reports and platform issues</li>
                  <li>Feature clarification</li>
                  <li>API integration guidance</li>
                  <li>Account configuration help</li>
                </ul>
              </div>

              <div className="space-y-3">
                <h3 className="text-base font-semibold">Support Boundaries</h3>
                <p className="leading-7 text-muted-foreground">We do not provide:</p>
                <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                  <li>Phone support or live calls</li>
                  <li>Dedicated account management</li>
                  <li>Custom development or feature builds</li>
                  <li>Training for your team members</li>
                  <li>Client-facing services</li>
                  <li>After-hours or weekend emergency support</li>
                </ul>
              </div>

              <div className="space-y-3">
                <h3 className="text-base font-semibold">Response Times</h3>
                <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                  <li>Priority ticket queue (front of line)</li>
                  <li>12-hour response time during business hours</li>
                  <li>Business hours: Monday-Friday, 9 AM - 5 PM EST</li>
                </ul>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
