export default function ProiectDetailPage({ params: { id } }: { params: { id: string } }) {
  return (
    <div className="fade-in-up">
      <h1 className="text-3xl font-bold tracking-tight">Proiect {id}</h1>
    </div>
  );
}
