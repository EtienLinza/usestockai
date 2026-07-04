export const LaunchLlamaBadge = () => {
  return (
    <a
      href="https://launchllama.co?utm_source=badge&utm_medium=referral"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/60 bg-muted/30 hover:bg-muted/50 hover:border-primary/30 transition-all duration-300 group"
    >
      <span className="text-[10px] text-muted-foreground tracking-wide uppercase font-medium">
        Featured on
      </span>
      <img
        src="https://speaktechenglish.com/wp-content/uploads/2026/04/Screenshot_2026-04-09_at_17.40.44-removebg-preview.png"
        alt="Launch Llama"
        width="80"
        height="20"
        loading="lazy"
        className="h-5 w-auto opacity-80 group-hover:opacity-100 transition-opacity duration-300"
      />
    </a>
  );
};
