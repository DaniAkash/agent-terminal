import FAQ from "@/components/site/FAQ";
import Footer from "@/components/site/Footer";
import FinalCTA from "@/components/site/FinalCTA";
import HowItWorks from "@/components/site/HowItWorks";
import Hero from "@/components/site/Hero";
import Mobile from "@/components/site/Mobile";
import Problem from "@/components/site/Problem";
import SocialProof from "@/components/site/SocialProof";
import Solution from "@/components/site/Solution";
import AgentState from "@/components/site/features/AgentState";
import Keymap from "@/components/site/features/Keymap";
import ModEngine from "@/components/site/features/ModEngine";
import StatusBarFeature from "@/components/site/features/StatusBar";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <SocialProof />
      <Problem />
      <Solution />
      <ModEngine />
      <AgentState />
      <StatusBarFeature />
      <Keymap />
      <Mobile />
      <HowItWorks />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  );
}
