import { Body, Container, Head, Html, Preview } from "@react-email/components";

// TODO: add preview props

export default function UnreadMentionEmail() {
  return (
    <Html>
      <Head />
      <Preview>Something</Preview>
      <Body>
        <Container>{/*TODO */}</Container>
      </Body>
    </Html>
  );
}
