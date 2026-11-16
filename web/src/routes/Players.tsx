import { PageHeader, Section } from "../components/Page";
import { PlayerSearch } from "../components/PlayerSearch";

export function Players() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Players">Every player with stats since 1999.</PageHeader>
      <Section title="Find a player">
        <PlayerSearch autoFocus />
      </Section>
    </div>
  );
}
