import React, { useState, useEffect } from "react";
import { createPrivateLink, deletePrivateLink, getPrivateLinks } from "admin/admin_rest_api";
import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import Toast from "libs/toast";

// Create a client
const queryClient = new QueryClient();

export function PrivateLinksView() {
  return (
    // Provide the client to your App
    <QueryClientProvider client={queryClient}>
      <PrivateLinksViewInner />
    </QueryClientProvider>
  );
}

export function PrivateLinksViewInner() {
  // Access the client
  const queryClient = useQueryClient();

  // Queries
  debugger;
  const { isLoading, error, data } = useQuery(["links"], getPrivateLinks);

  // Mutations
  const mutation = useMutation(createPrivateLink, {
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries(["links"]);
    },
  });
  const deleteMutation = useMutation(deletePrivateLink, {
    onMutate: async (linkIdToDelete) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries(["links"]);

      // Snapshot the previous value
      const previousLinks = queryClient.getQueryData(["links"]);

      // Optimistically update to the new value
      queryClient.setQueryData(["links"], (oldItems) =>
        oldItems.filter((link) => link._id.id != linkIdToDelete),
      );

      // Return a context object with the snapshotted value
      return { previousLinks };
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (err, newTodo, context) => {
      Toast.error(`${err}`);
      queryClient.setQueryData(["links"], context.previousLinks);
    },
  });

  if (isLoading) {
    return <span>Loading...</span>;
  }

  if (error) {
    return <span>Error: {error.message}</span>;
  }

  return (
    <div>
      <ul>
        {data.map((link) => (
          <li key={link._id.id}>
            {link.accessToken}

            <button
              onClick={() => {
                deleteMutation.mutate(link._id.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <button
        onClick={() => {
          mutation.mutate("62f3b0d22102004bb5cb5b2e");
        }}
      >
        Add Link
      </button>
    </div>
  );
}
