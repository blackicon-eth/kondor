"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useLogin } from "@privy-io/react-auth";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { Button } from "@/components/ui/button";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const tech = [
  { name: "Chainlink CRE", description: "Automation workflows", highlight: false },
  { name: "Uniswap API", description: "Instant token swaps", highlight: true },
  { name: "ENS Subdomains", description: "Human-readable identities", highlight: false },
];

export default function Home() {
  const { login } = useLogin();

  return (
    <div className="flex flex-col h-screen bg-surface text-on-surface font-body selection:bg-primary-container selection:text-on-primary-container overflow-hidden">
      <Navbar />

      {/* Main */}
      <main className="grow flex items-center relative overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-surface via-surface-container-low to-surface" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-primary-container/5 blur-[150px]" />
        </div>

        <div className="container mx-auto px-8 z-20 h-full py-8">
          <div className="grid lg:grid-cols-2 gap-32 items-center h-full">
            {/* Left: Value Prop & CTA */}
            <motion.div
              className="flex flex-col space-y-6 md:space-y-10"
              initial="hidden"
              animate="visible"
            >
              <motion.div
                custom={0}
                variants={fadeUp}
                className="inline-flex items-center space-x-3 bg-surface-container-high px-4 py-1.5 border-l-4 border-primary-container self-start"
              >
                <svg className="w-3.5 h-3.5 text-primary-container" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11 21h-1l1-7H7.5c-.88 0-.33-.75-.31-.78C8.48 10.94 10.42 7.54 13.01 3h1l-1 7h3.51c.4 0 .62.19.4.66C12.97 17.55 11 21 11 21z" />
                </svg>
                <span className="font-label text-xs tracking-[0.2em] uppercase text-secondary-ds">
                  Kondor Protocol Ready
                </span>
              </motion.div>

              <div className="space-y-4">
                <motion.h1
                  custom={1}
                  variants={fadeUp}
                  className="font-headline text-[88px] font-black text-on-surface leading-[0.95] tracking-tighter"
                >
                  AUTOMATE YOUR
                  <br />
                  <span className="text-primary-container">INCOMING CRYPTO</span>
                </motion.h1>
                <motion.p
                  custom={2}
                  variants={fadeUp}
                  className="text-secondary-ds max-w-xl text-xl md:text-2xl leading-relaxed font-body"
                >
                  The privacy first automation engine for your tokens. Route, swap, and
                  stake assets the moment they arrive, all anonymously.
                </motion.p>
              </div>

              <motion.div custom={3} variants={fadeUp}>
                <Button variant="primary" size="hero" onClick={login}>Launch App</Button>
              </motion.div>

              {/* Stats */}
              <motion.div
                custom={4}
                variants={fadeUp}
                className="grid grid-cols-3 gap-6 pt-6 border-t border-outline-variant/10"
              >
                {tech.map((item) => (
                  <div key={item.name} className="flex flex-col justify-center items-start space-y-1 w-full shrink-0">
                    <div className={`text-2xl font-black font-headline uppercase tracking-wide whitespace-nowrap ${item.highlight ? "text-primary-container" : "text-on-surface"}`}>
                      {item.name}
                    </div>
                    <div className="text-sm text-secondary-ds font-label">
                      {item.description}
                    </div>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            {/* Right: Logo & HUD */}
            <motion.div
              className="relative hidden lg:flex justify-center items-center"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="relative w-full max-w-[34rem] aspect-square">
                {/* Logo container */}
                <div className="absolute inset-0 bg-surface-container-lowest crimson-glow" style={{ maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)" }} />
                <div className="absolute inset-0 flex items-center justify-center p-12">
                  <Image
                    src="/kondor_logo.png"
                    alt="Kondor Logo"
                    width={400}
                    height={400}
                    className="w-full h-full object-contain relative z-10"
                    priority
                  />
                </div>

                {/* HUD overlay: top-right — workflow */}
                <motion.div
                  className="absolute -top-6 -right-6 bg-surface-container-highest p-5 glass-panel border-r-2 border-primary-container"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6, delay: 0.8 }}
                >
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <svg className="w-3.5 h-3.5 text-primary-container" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
                      </svg>
                      <span className="text-xs text-on-surface font-black uppercase tracking-widest font-label">
                        Workflow
                      </span>
                    </div>
                    <div className="h-px bg-outline-variant/20" />
                    <div className="flex items-center gap-2 font-label text-sm text-on-surface font-bold uppercase tracking-wide">
                      <span>Receive</span>
                      <ChevronRight className="w-4 h-4 text-primary-container" />
                      <span>Policy</span>
                      <ChevronRight className="w-4 h-4 text-primary-container" />
                      <span>Action</span>
                    </div>
                  </div>
                </motion.div>

                {/* HUD overlay: bottom-left — powered by */}
                <motion.div
                  className="absolute -bottom-8 -left-8 bg-surface-container-highest p-6 font-label space-y-3 glass-panel border-l-2 border-primary-container"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6, delay: 1.0 }}
                >
                  <div className="flex justify-between items-center gap-12">
                    <span className="text-xs text-secondary-ds tracking-widest uppercase">
                      Privacy
                    </span>
                    <span className="text-primary-container font-black text-sm">Railgun</span>
                  </div>
                  <div className="h-px bg-outline-variant/15 w-full" />
                  <div className="flex justify-between items-center gap-12">
                    <span className="text-xs text-secondary-ds tracking-widest uppercase">
                      Offramp
                    </span>
                    <span className="text-on-surface font-black text-sm">Monerium</span>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
