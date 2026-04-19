import { Hero } from "@/components/marketing/hero";
import { Locations } from "@/components/marketing/locations";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { FeatureDeepDive } from "@/components/marketing/feature-deep-dive";
import { ShowcaseGrid } from "@/components/marketing/showcase-grid";
import { Testimonial } from "@/components/marketing/testimonial";
import { CtaBanner } from "@/components/marketing/cta-banner";

export default function HomePage() {
  return (
    <>
      <Hero
        variant="full"
        imageKey="hero-yoga-01"
        eyebrow="Tai Seng & Outram Park, Singapore"
        headline="Find Your Yoga {rotating}"
        rotatingWords={["Classes", "Workshops", "Private Sessions", "Packages"]}
        subheadline="Yoga Sadhana is a boutique yoga studio offering traditional group classes, specialised workshops, and one-on-one sessions across two Singapore locations."
        primaryCta={{ href: "/classes", label: "Browse classes" }}
        secondaryCta={{ href: "/packages", label: "View packages" }}
      />

      <Locations />

      <FeatureGrid
        eyebrow="Everything you need"
        headline="A complete practice, on your schedule."
        items={[
          { icon: "Calendar",  label: "Easy booking",      description: "Reserve with one tap from the weekly calendar." },
          { icon: "Sparkles",  label: "Class packages",    description: "Credit bundles, unlimited memberships, or drop-in." },
          { icon: "Users",     label: "Private sessions",  description: "1-on-1 or 2-on-1 with our certified instructors." },
          { icon: "Award",     label: "Workshops",         description: "Specialised deep-dives and community events." },
          { icon: "QrCode",    label: "QR check-in",       description: "A unique code per booking — no signing in at the door." },
          { icon: "Gift",      label: "Referral rewards",  description: "Earn S$20 credit when a friend joins." },
        ]}
      />

      <FeatureDeepDive
        direction="right"
        eyebrow="Group classes"
        headline="Book the whole week at a glance."
        body="Our calendar makes finding your next class effortless — filter by location, level, or style and book with credits in two taps."
        bullets={[
          "Weekly calendar view across both studios",
          "Real-time availability and waitlist",
          "Cancel up to 6 hours before with no penalty",
        ]}
        imageKey="hero-pilates-01"
        imageAlt="Weekly classes calendar"
        cta={{ href: "/classes", label: "See this week's schedule" }}
      />

      <FeatureDeepDive
        direction="left"
        eyebrow="Credit packages"
        headline="Pricing that fits your rhythm."
        body="Whether you practice twice a week or every day, there's a package that matches your pace — and credits never expire mid-month."
        bullets={[
          "Bundle credits with no expiry pressure",
          "Unlimited monthly with full studio access",
          "Family-shareable VIP packages for 2-on-1 sessions",
        ]}
        imageKey="hero-meditation-01"
        imageAlt="Class packages"
        cta={{ href: "/packages", label: "Browse packages" }}
      />

      <FeatureDeepDive
        direction="right"
        eyebrow="Two locations"
        headline="One membership, both studios."
        body="Practice at Breadtalk IHQ in Lavender or Outram Park — the same package works at either, so you can book whichever fits your day."
        bullets={[
          "Cross-location credits",
          "Per-location filter on the calendar",
          "WhatsApp the front desk for help",
        ]}
        imageKey="hero-studio-01"
        imageAlt="Studio interior"
      />

      <ShowcaseGrid
        columns={3}
        eyebrow="What we offer"
        headline="Find what fits your week."
        items={[
          { imageKey: "cat-yoga",       imageAlt: "Group yoga class",       label: "Classes",          description: "Traditional group classes for every level.", href: "/classes" },
          { imageKey: "cat-workshop",   imageAlt: "Workshop in progress",   label: "Workshops",        description: "Limited-spot deep-dives.",                    href: "/workshops" },
          { imageKey: "cat-meditation", imageAlt: "One-on-one instruction", label: "Private sessions", description: "1-on-1 or 2-on-1 with certified teachers.",   href: "/private-sessions" },
        ]}
      />

      <Testimonial
        quote="Switching to Sadhana made my practice consistent for the first time in years. The calendar is the cleanest I've used and the instructors actually remember your name."
        attribution={{ name: "Priya M.", role: "Member since 2024" }}
      />

      <CtaBanner
        imageKey="cta-evening"
        eyebrow="Ready when you are"
        headline="Roll out your mat."
        subheadline="Browse this week's classes or grab a package to get started."
        primaryCta={{ href: "/classes", label: "Browse classes" }}
        secondaryCta={{ href: "/packages", label: "See packages" }}
      />
    </>
  );
}
