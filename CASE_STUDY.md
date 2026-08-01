# Case Study: Building SmartLeadGen — Finding Clients Before They Find You

## The problem

Freelance web developers, SEO consultants, and small marketing agencies all
face the same first step: finding businesses that actually need what they
sell. In practice, that usually means scrolling Google Maps by hand, city by
city, category by category, checking one listing at a time for whether a
business even has a website — a task that eats hours before any actual
outreach begins.

## The idea

SmartLeadGen automates exactly that first step. Give it a business type and
a location — or describe a goal in plain words — and it searches Google's
own Places data, visits each result's own website (if it has one) for a
contact email and social links, and scores every lead High/Medium/Low based
on how weak (or missing) their online presence already is. No website at
all is the strongest signal of all: that's a lead where the pitch writes
itself.

## An early test run

Running a search for "digital marketing" businesses in Tangail, Bangladesh
surfaced two dozen real, current listings in under a minute — agencies,
freelancers, and consultants, complete with phone numbers and, where
available, direct emails scraped from their own sites. The large majority
had no website at all, or nothing beyond a bare Facebook page — exactly the
kind of lead a freelance developer or SEO consultant would want to reach
first. A second run against beauty salons in Dhaka's Banani/Gulshan area
turned up a similar pattern: strong Google presence, weak-to-nonexistent
websites — a different vertical, same underlying opportunity.

[See it running →](https://github.com/bayzed123/SmartLedGen/blob/951a0f1e3a05b2ffc900e15548b0c049bbe73d9d/diagrams/video/proof/Dashboard/SmartgenLeadGenaratorDashboard.webp)

## How it's built

- **Cloudflare Workers** for the API — no servers to manage, runs at the edge
- **Cloudflare D1** for storage, with every user's data isolated by account —
  nobody, including the people running the product, can see another user's
  leads or API keys
- **Bring-your-own-key model**: users connect their own Google Places API
  key (their own Google Cloud billing, their own quota) rather than the
  product reselling API access — the fastest way to guarantee nobody
  overpays for someone else's usage
- **Cloudflare Workers AI** powering the in-app support assistant, on the
  free tier — no separate AI vendor account required just to answer setup
  questions
- Optional Gemini/OpenAI/Claude integration (also bring-your-own-key) for
  turning a plain-English goal into a search, and — soon — drafting the
  first outreach message per lead

## Where it stands today

SmartLeadGen is in testing, not yet a finished product — pricing hasn't
been set, and the current build started life as a Streamlit prototype
before being rebuilt from scratch for Cloudflare to fix reliability issues
the original had. One free search is available on every account right now,
no card required, while real usage data informs what fair pricing actually
looks like before anything is charged.

## What's next

- A "Log in with Google" option alongside the existing email/password login
- AI-drafted outreach email copy per lead, using the same optional AI key
- Continued refinement based on real usage across more cities and verticals

---
*Built by Sayad Md Bayezid Hosan. Feedback from anyone who tries it — what
worked, what didn't, what's missing — genuinely shapes what gets built
next.*
