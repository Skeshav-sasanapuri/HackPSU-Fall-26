export function Stars({ n, of = 3, size = 26 }: { n: number; of?: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${n} of ${of} stars`}>
      {Array.from({ length: of }, (_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path d="M12 2.5l2.9 6.2 6.6.7-5 4.5 1.4 6.6L12 17.2l-5.9 3.3 1.4-6.6-5-4.5 6.6-.7z"
            fill={i < n ? '#d4a017' : 'none'} stroke="#17130e" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  );
}
