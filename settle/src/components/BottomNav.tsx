"use client";

import { motion } from "framer-motion";
import { Wallet, Clock, User } from "lucide-react";

type Screen = "home" | "orders" | "profile";

interface BottomNavProps {
  currentScreen: string;
  onNavigate: (screen: Screen) => void;
  maxWidth?: string;
}

const navItems = [
  { key: "home" as Screen, icon: Wallet, label: "Home" },
  { key: "orders" as Screen, icon: Clock, label: "Activity" },
  { key: "profile" as Screen, icon: User, label: "Profile" },
];

export default function BottomNav({ currentScreen, onNavigate, maxWidth = "max-w-md" }: BottomNavProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      <div className={`${maxWidth} mx-auto`}>
        <div className="bottom-nav-solid px-6 pb-8 pt-3 pb-safe">
          <div className="flex items-center justify-around">
            {navItems.map(({ key, icon: Icon, label }) => (
              <motion.button
                key={key}
                whileTap={{ scale: 0.95 }}
                onClick={() => onNavigate(key)}
                className={`flex flex-col items-center gap-1 relative px-4 py-1 rounded-xl transition-all ${
                  currentScreen === key ? "text-orange-400" : "text-neutral-600"
                }`}
              >
                {currentScreen === key && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute inset-0 bg-orange-500/10 rounded-xl"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <Icon className="w-5 h-5 relative z-10" strokeWidth={currentScreen === key ? 2.5 : 1.5} />
                <span className="text-[10px] font-medium relative z-10">{label}</span>
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
