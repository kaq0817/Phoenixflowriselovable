export default function PrivacyPolicyPage() {
  const company = "Go Hard Gaming D LLC";

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-1 w-32 rounded-full gradient-phoenix" />
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Privacy Policy
          </h1>
          {/* <p className="text-sm text-muted-foreground sm:text-base">
            Effective Date removed
          </p> */}
        </div>

        <div className="glass-panel rounded-3xl border border-border/50 p-6 sm:p-8 lg:p-10">
          <div className="space-y-8">
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">1. Introduction</h2>
              <p className="leading-7 text-muted-foreground">
                {company} (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your privacy.
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information
                when you visit ironphoenixflow.com and use the Phoenix Flow application.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">2. Information We Collect</h2>
              <p className="leading-7 text-muted-foreground">
                We collect information that you provide directly to us, such as:
              </p>
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li><strong className="text-foreground">Account Information:</strong> Name, email address, business name, and password when you register.</li>
                <li><strong className="text-foreground">Payment Information:</strong> Billing address and payment method details. We use Stripe to process payments and do not store full credit card numbers.</li>
                <li><strong className="text-foreground">Store Data:</strong> When you connect your Shopify or Etsy store, we access product data such as titles, descriptions, and images to provide optimization services.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">3. How We Use Your Information</h2>
              <p className="leading-7 text-muted-foreground">
                We use the information we collect to:
              </p>
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li>Provide, maintain, and improve our services.</li>
                <li>Process transactions and manage your subscription.</li>
                <li>Generate AI-powered content such as descriptions and ads based on your product data.</li>
                <li>Send administrative notices, updates, and support messages.</li>
                <li>Comply with legal obligations and prevent fraud.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">4. Sharing of Information</h2>
              <p className="leading-7 text-muted-foreground">
                We may share your information with:
              </p>
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li><strong className="text-foreground">Service Providers:</strong> Third-party vendors such as Stripe for payments, Cloudflare for hosting, and Google Gemini for AI processing who assist in our operations.</li>
                <li><strong className="text-foreground">Legal Requirements:</strong> If required by law, regulation, or legal process.</li>
              </ul>
              <p className="leading-7 text-muted-foreground">
                We do not sell your personal data to third parties.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">5. Data Security</h2>
              <p className="leading-7 text-muted-foreground">
                We implement appropriate technical and organizational measures to protect your personal data against unauthorized access, alteration, disclosure, or destruction. However, no internet transmission is completely secure, and we cannot guarantee absolute security.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">6. Your Rights</h2>
              <p className="leading-7 text-muted-foreground">
                Depending on your location, you may have rights to access, correct, delete, or restrict the use of your personal data. To exercise these rights, please contact us.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">7. Contact Us</h2>
              <p className="leading-7 text-muted-foreground">
                If you have questions about this Privacy Policy, please contact us at {" "}
                <a className="font-medium text-primary transition hover:text-accent" href="mailto:karen.brandmeyer@ironphoenixflow.com">
                  karen.brandmeyer@ironphoenixflow.com
                </a>.
              </p>
            </section>

            <div className="border-t border-border/50 pt-6 text-center text-sm text-muted-foreground">
              <p>
                <a className="font-medium text-primary transition hover:text-accent" href="/pricing">Back to Pricing</a>
                <span className="mx-3 text-border">|</span>
                <a className="font-medium text-primary transition hover:text-accent" href="/terms">Terms of Service</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
