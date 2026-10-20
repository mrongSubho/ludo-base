"use client";

import React from "react";
import { useAuthPrompt, cancelAuthPrompt } from "@/hooks/useAuthPrompt";
import { SignWaitModal } from "./SignWaitModal";

export default function GlobalSignWaitModal() {
    const prompt = useAuthPrompt();

    return (
        <SignWaitModal
            isOpen={prompt.isOpen}
            title={prompt.title}
            badgeText={prompt.badgeText}
            statusText={prompt.statusText}
            onCancel={cancelAuthPrompt}
        />
    );
}
