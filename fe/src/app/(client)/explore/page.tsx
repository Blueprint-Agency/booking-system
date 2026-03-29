"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import type { Tenant, Session } from "@/types";
import tenants from "@/data/tenants.json";
import sessions from "@/data/sessions.json";

const typedTenants = tenants as Tenant[];
const typedSessions = sessions as Session[];

const INDUSTRIES = [
  "All",
  "Fitness",
  "Arts & Crafts",
  "Cooking",
  "Music",
  "Wellness",
  "Education",
] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

function getSessionCount(tenantId: string): number {
  return typedSessions.filter((s) => s.tenantId === tenantId).length;
}

export default function ExplorePage() {
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("All");

  const filtered = useMemo(() => {
    return typedTenants.filter((t) => {
      const matchesSearch =
        search === "" ||
        t.name.toLowerCase().includes(search.toLowerCase());
      const matchesIndustry =
        industry === "All" || t.industry === industry;
      return matchesSearch && matchesIndustry;
    });
  }, [search, industry]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="font-serif text-3xl sm:text-4xl text-ink mb-2">
          Explore
        </h1>
        <p className="text-muted text-sm mb-6">
          Discover studios, workshops, and classes near you.
        </p>
      </motion.div>

      {/* Search Bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mb-4"
      >
        <div className="relative">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="w-full pl-10 pr-4 py-2.5 bg-warm border border-border rounded-md text-sm text-ink placeholder:text-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
          />
        </div>
      </motion.div>

      {/* Industry Filter Pills */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="flex flex-wrap gap-2 mb-6"
      >
        {INDUSTRIES.map((ind) => (
          <button
            key={ind}
            onClick={() => setIndustry(ind)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-full border transition-all duration-200",
              industry === ind
                ? "bg-accent text-white border-accent shadow-soft"
                : "bg-warm text-muted border-border hover:text-ink hover:border-accent/40"
            )}
          >
            {ind}
          </button>
        ))}
      </motion.div>

      {/* Result Count */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="text-sm text-muted mb-6"
      >
        Showing {filtered.length} business{filtered.length !== 1 ? "es" : ""}
      </motion.p>

      {/* Tenant Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="--"
          title="No businesses found"
          description="Try adjusting your search or filters to find available businesses."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((tenant, i) => {
            const sessionCount = getSessionCount(tenant.id);
            return (
              <motion.div
                key={tenant.id}
                custom={i}
                variants={fadeUp}
                initial="hidden"
                animate="visible"
              >
                <Link
                  href={`/explore/${tenant.slug}`}
                  className="block bg-card border border-border rounded-xl overflow-hidden shadow-soft hover:shadow-hover transition-all duration-300 hover:-translate-y-1"
                >
                  {/* Cover Image */}
                  <img
                    src={tenant.coverUrl}
                    alt={tenant.name}
                    className="w-full h-32 object-cover rounded-t-xl"
                  />

                  <div className="p-6">
                    {/* Logo + Name */}
                    <div className="flex items-start gap-4 mb-3">
                      <img
                        src={tenant.logoUrl}
                        alt={tenant.name + ' logo'}
                        className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-soft flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <h3 className="font-serif text-lg text-ink truncate">
                          {tenant.name}
                        </h3>
                        <span
                          className={cn(
                            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide bg-warm text-muted mt-1"
                          )}
                        >
                          {tenant.industry}
                        </span>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-muted mb-3 line-clamp-2">
                      {tenant.shortDescription}
                    </p>

                    {/* Location + Session Count */}
                    <div className="flex items-center justify-between text-xs text-muted pt-3 border-t border-border">
                      <span className="flex items-center gap-1.5">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        {tenant.location}
                      </span>
                      <span className="font-medium">
                        {sessionCount} session{sessionCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
