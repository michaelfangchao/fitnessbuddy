"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PinEntry from "@/components/PinEntry";

type UserProfile = {
  id: number;
  name: string;
  goal: string | null;
  gender: string | null;
};

export default function ProfileSelectPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [selected, setSelected] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/users")
      .then((r) => r.json())
      .then((data) => {
        setProfiles(data.users ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleSuccess(userId: number) {
    router.push(`/chat/${userId}`);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
      </div>
    );
  }

  if (selected) {
    return (
      <PinEntry
        user={selected}
        onSuccess={() => handleSuccess(selected.id)}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">FitChat</h1>
        <p className="mt-2 text-sm text-neutral-400">Who&apos;s training today?</p>
      </div>

      {profiles.length === 0 ? (
        <div className="text-center text-sm text-neutral-500">
          <p>No profiles yet.</p>
          <p className="mt-1">Run the seed script to create your first profile.</p>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-6">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className="flex flex-col items-center gap-3 rounded-xl p-4 transition-all hover:bg-neutral-800 active:scale-95"
            >
              <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-neutral-800 text-4xl">
                {p.gender === "female" ? "👩" : "👨"}
              </div>
              <span className="text-sm font-medium text-neutral-200">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
